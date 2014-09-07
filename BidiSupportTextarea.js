/** @module dbidiui/BidiSupportTextarea */
define([
	"dcl/dcl",
	"decor/Stateful",
	"dojo/_base/array",
	"dojo/aspect",
	"dojo/_base/lang",
	"dojo/dom-attr",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/i18n",
	"dojo/dom-style",
	"dojo/sniff",
	"dojo/query",
	"dbidiui/range",
], function(dcl,Stateful,array,aspect,lang,domAttr,domClass,domConstruct,i18n,domStyle,has,query,rangeapi){
	/**
	 * This class provides some advanced BiDi support for BiDi Textarea widget 
	 * {@link module:deliteful/Textarea/bidi/Textarea widget}.
	 *
	 * It adds several bidi-specific commands ('set text direction to left-to-right', 
	 * 'set text direction to right-to-left', 'change text direction to opposite').
	 *
	 * @class module:dbidiui/BidiSupportTextarea
	 * @augments module:dbidiui/Textarea
	 */
	
	var BidiSupportTextarea = dcl(Stateful,{		

		// blockMode: [const] String
		//		This property decides the behavior of Enter key, actually released by EnterKeyHandling 
		//		plugin. Possible values are 'P' and 'DIV'. Used when EnterKeyHandling isn't included 
		//		into the list of the base plugins, loaded with the current Editor, as well as in case,  
		//		if blockNodeForEnter property of EnterKeyHandling plugin isn't set to 'P' or 'DIV'.
		//		The default value is "DIV".
		blockMode: "DIV",

		// bogusHtmlContent: [private] String
		//		HTML to stick into a new empty block	
		bogusHtmlContent: ' ',

		_lineTextArray: ["DIV","P","LI","H1","H2","H3","H4","H5","H6","ADDRESS","PRE","DT","DE","TD"],
		_lineStyledTextArray: ["H1","H2","H3","H4","H5","H6","ADDRESS","PRE","P"],
		_tableContainers: ["TABLE","THEAD","TBODY","TR"],
		_blockContainers: ["TABLE","OL","UL","BLOCKQUOTE"],
		
		updateState: function(){
			// summary:
			//		Override _Plugin.updateState(). Determines direction of the text in the 
			//		start point of the current selection. Changes state of the buttons
			//		correspondingly.
			if(!this.editor || !this.editor.isLoaded || this.shortcutonly){
				return;
			}
			if(this.disabled){
				return;
			}
			var sel = rangeapi.getSelection(this.editor.window);
			if(!sel || sel.rangeCount === 0){
				return;
			}	
			var range = sel.getRangeAt(0), node;
			if(range.startContainer === this.editor.editNode && !range.startContainer.hasChildNodes()){
				node = range.startContainer;
			}else{
				var startNode = range.startContainer,
					startOffset = range.startOffset;
				if(this._isBlockElement(startNode)){
					while(startNode.hasChildNodes()){
						if(startOffset == startNode.childNodes.length){
							startOffset--;
						}
						startNode = startNode.childNodes[startOffset];
						startOffset = 0;
					}
				}
				node = this._getBlockAncestor(startNode);
			}
			var cDir = domStyle.get(node,"direction");
		},
		
		setEditor: function(/*dijit.Editor*/ editor){
			// summary:
			//		Override _Plugin.setEditor().
			// description:
			//		Sets editor's flag 'advancedBidi' to true, which may be used by other plugins 
			//		as a switch to bidi-specific behaviour. Adds bidi-specific filters, including 
			//		postDom filter, which provides explicit direction settings for the blocks 
			//		of the text, direction of which isn't defined. Overrides some native commands,
			//		which should be changed or expanded in accordance with bidi-specific needs.
			//		Loads EnterKeyHandling plugin, if it was not loaded, and changes its 
			//		blockNodeForEnter property, if it is needed. Defines shortcut, which will cause
			//		execution of 'change text direction to opposite' ('mirror') command.
			this.editor = editor;
			// Delete new lines and tabs from everywhere excluding contents of PRE elements.
			// Explicit direction setting
			var postDomFilterSetDirExplicitly = lang.hitch(this, function(node){			
				if(this.disabled || !node.hasChildNodes()){
					return node;
				}
				this._changeStateOfBlocks(this.editor.editNode, this.editor.editNode, this.editor.editNode, "explicitdir", null);
				return this.editor.editNode;
			});
			// FF: Native change alignment command for more then one DIV doesn't change actually alignment, but damages 
			// markup so, that selected DIV's are converted into sequence of text elements, separated by <br>'s.
			// Override native command
			this.editor._justifyleftImpl = lang.hitch(this, function(){
				this._changeState("left");
				return true;
			});
			this.editor._justifyrightImpl = lang.hitch(this, function(){
				this._changeState("right");
				return true;
			});
			this.editor._justifycenterImpl = lang.hitch(this, function(){
				this._changeState("center");
				return true;
			});
		},

				
		_changeState: function(cmd,arg){
			// summary:
			//		Determines and refines current selection and calls method 
			//		_changeStateOfBlocks(), where given action is actually done
			// description:
			//		The main goal of this method is correctly identify the block elements,
			//		that are at the beginning and end of the current selection. 
			// return: nodesInfo
			//		Object containing
			//			nodes:  array of all block nodes, which should be handled by this command
			//			groups: array containing groups of nodes. Nodes from each group should be handled by separate 
			//					execution of current command
			//			cells:	array of cells, contents of which should be handled by current command
			if(!this.editor.window){
				return;
			}
			
			var sel = rangeapi.getSelection(this.editor.window);
			if(!sel || sel.rangeCount === 0){
				return;
			}
			var range = sel.getRangeAt(0), tempRange = range.cloneRange(),
				startNode, endNode, startOffset, endOffset;
			startNode = range.startContainer;
			startOffset = range.startOffset;
			endNode = range.endContainer;
			endOffset = range.endOffset;
			var isCollapsed = startNode === endNode && startOffset == endOffset;
			if(this._isBlockElement(startNode) || this._hasTagFrom(startNode,this._tableContainers)){
				while(startNode.hasChildNodes()){
					if(startOffset == startNode.childNodes.length){
						startOffset--;
					}	
					startNode = startNode.childNodes[startOffset];
					startOffset = 0;
				}
			}
			tempRange.setStart(startNode, startOffset);
			startNode = this._getClosestBlock(startNode,"start",tempRange);
			var supList = rangeapi.getBlockAncestor(startNode, /li/i, this.editor.editNode).blockNode;
			if(supList && supList !== startNode){
				startNode = supList;
			}
			endNode = tempRange.endContainer;
			endOffset = tempRange.endOffset;
			if(this._isBlockElement(endNode) || this._hasTagFrom(endNode,this._tableContainers)){
				while(endNode.hasChildNodes()){
					if(endOffset == endNode.childNodes.length){
						endOffset--;
					}
					endNode = endNode.childNodes[endOffset];
					if(endNode.hasChildNodes()){
						endOffset = endNode.childNodes.length;
					}else if(endNode.nodeType == 3 && endNode.nodeValue){
						endOffset = endNode.nodeValue.length;
					}else{
						endOffset = 0;
					}
				}
			}
			tempRange.setEnd(endNode, endOffset);
			endNode = this._getClosestBlock(endNode,"end",tempRange);
			supList = rangeapi.getBlockAncestor(endNode, /li/i, this.editor.editNode).blockNode;
			if(supList && supList !== endNode){
				endNode = supList;
			}
			sel = rangeapi.getSelection(this.editor.window, true);
			sel.removeAllRanges();
			sel.addRange(tempRange);
			var commonAncestor = rangeapi.getCommonAncestor(startNode, endNode);
			var nodesInfo = this._changeStateOfBlocks(startNode, endNode, commonAncestor, cmd, arg, tempRange);
			if(isCollapsed){
				endNode = tempRange.startContainer;
				endOffset = tempRange.startOffset;
				tempRange.setEnd(endNode, endOffset);
				sel = rangeapi.getSelection(this.editor.window, true);
				sel.removeAllRanges();
				sel.addRange(tempRange);				
			}
			return nodesInfo;
		},

		_isBlockElement: function(node){
			if(!node || node.nodeType != 1){
				return false;
			}
			var display = domStyle.get(node,"display");
			return (display == 'block' || display == "list-item" || display == "table-cell");
		},
		
		_isInlineOrTextElement: function(node){
			return !this._isBlockElement(node) && (node.nodeType == 1 || node.nodeType == 3 || node.nodeType == 8);
		},
		
		_isElement: function(node){
			return node && (node.nodeType == 1 || node.nodeType == 3);
		},
		
		_isBlockWithText: function(node){
			return node !== this.editor.editNode && this._hasTagFrom(node,this._lineTextArray);
		},
		
		_getBlockAncestor: function(node){
			while(node.parentNode && !this._isBlockElement(node)){
				node = node.parentNode;
			}
			return node;
		},
		
		_getClosestBlock: function(node, point, tempRange){
			// summary:
			//		Searches for a closest block element containing the text which 
			//		is at a given point of current selection. Refines current
			//		selection, if text element from start or end point was merged 
			//		with its neighbors.
			if(this._isBlockElement(node)){
				return node;
			}
			var parent = node.parentNode,
				firstSibling, lastSibling,
				createOwnBlock = false,
				multiText = false;
				removeOffset = false;
			while(true){
				var sibling = node;
				createOwnBlock = false;
				while(true){
					if(this._isInlineOrTextElement(sibling)){
						firstSibling = sibling;
						if(!lastSibling){
							lastSibling = sibling;
						}
					}
					sibling = sibling.previousSibling;
					if(!sibling){
						break;
					}else if(this._isBlockElement(sibling) || this._hasTagFrom(sibling,this._blockContainers) || this._hasTag(sibling,"BR")){
						createOwnBlock = true;
						break;
					}else if(sibling.nodeType == 3 && sibling.nextSibling.nodeType == 3){
						// Merge neighboring text elements
						sibling.nextSibling.nodeValue = sibling.nodeValue + sibling.nextSibling.nodeValue;
						multiText = true;
						if(point == "start" && sibling === tempRange.startContainer){
							tempRange.setStart(sibling.nextSibling, 0);
						}else if(point == "end" && (sibling === tempRange.endContainer || sibling.nextSibling === tempRange.endContainer)){
							tempRange.setEnd(sibling.nextSibling, sibling.nextSibling.nodeValue.length);
						}
						sibling = sibling.nextSibling;
						sibling.parentNode.removeChild(sibling.previousSibling);
						if(!sibling.previousSibling){
							break;
						}
					}
				}
				sibling = node;
				while(true){
					if(this._isInlineOrTextElement(sibling)){
						if(!firstSibling){
							firstSibling = sibling;
						}
						lastSibling = sibling;
					}	
					sibling = sibling.nextSibling;
					if(!sibling){
						break;				
					}else if(this._isBlockElement(sibling) || this._hasTagFrom(sibling,this._blockContainers)){
						createOwnBlock = true;
						break;
					}else if(this._hasTag(sibling,"BR") && sibling.nextSibling && !(this._isBlockElement(sibling.nextSibling) || 
							this._hasTagFrom(sibling.nextSibling,this._blockContainers))){
						lastSibling = sibling;
						createOwnBlock = true;
						break;						
					}else if(sibling.nodeType == 3 && sibling.previousSibling.nodeType == 3){
						// Merge neighboring text elements
						sibling.previousSibling.nodeValue += sibling.nodeValue;
						multiText = true;
						if(point == "start" && sibling === tempRange.startContainer){
							tempRange.setStart(sibling.previousSibling, 0);
						}else if(point == "end" && (sibling === tempRange.endContainer || sibling.previousSibling === tempRange.endContainer)){
							tempRange.setEnd(sibling.previousSibling, sibling.previousSibling.nodeValue.length);
						}					
						sibling = sibling.previousSibling;
						sibling.parentNode.removeChild(sibling.nextSibling);
						if(!sibling.nextSibling){
							break;
						}
					}
				}
				// If text in the start or end point of the current selection doesn't placed in some block element 
				// or if it has block siblings, new block, containing this text element (and its inline siblings) is created.
				if(createOwnBlock || (this._isBlockElement(parent) && 
						!this._isBlockWithText(parent) && firstSibling)){
					var origStartOffset = tempRange? tempRange.startOffset : 0,
						origEndOffset = tempRange? tempRange.endOffset : 0,
						origStartContainer = tempRange? tempRange.startContainer : null,
						origEndContainer = tempRange? tempRange.endContainer : null,
						divs = this._repackInlineElements(firstSibling, lastSibling, parent),
						div = divs[point == "start"? 0 : divs.length-1];
						if(tempRange && div && firstSibling === origStartContainer && this._hasTag(firstSibling,"BR")){
							origStartContainer = div;
							origStartOffset = 0;
							if(lastSibling === firstSibling){
								origEndContainer = origStartContainer;
								origEndOffset = 0;
							}
						}
					if(tempRange){
						tempRange.setStart(origStartContainer, origStartOffset);
						tempRange.setEnd(origEndContainer, origEndOffset);
					}
					return div;
				}
				if(this._isBlockElement(parent)){
					return parent;
				}
				node = parent;
				removeOffset = true;
				parent = parent.parentNode;
				firstSibling = lastSibling = null;
			}
		},
		
		_changeStateOfBlocks: function(startNode, endNode, commonAncestor, cmd, arg, tempRange){
			// summary:
			//		Collects all block elements, containing text, which are inside of current selection,
			//		and performs for each of them given action.
			//		Possible commands and corresponding actions:
			//			- "ltr":					change direction to left-to-right
			//			- "rtl":					change direction to right-to-left
			//			- "mirror":					change direction to opposite
			//			- "explicitdir":			explicit direction setting
			//			- "left":					change alignment to left
			//			- "right":					change alignment to right
			//			- "center":					change alignment to center
			//			- "formatblock":			action should be done after executing native formatblock
			var nodes = [];
			// Refine selection, needed for 'explicitdir' command (full selection)
			if(startNode === this.editor.editNode){
				if(!startNode.hasChildNodes()){
					return;
				}
				if(this._isInlineOrTextElement(startNode.firstChild)){
					this._rebuildBlock(startNode);
				}
				startNode = this._getClosestBlock(startNode.firstChild, "start", null);
			}
			if(endNode === this.editor.editNode){
				if(!endNode.hasChildNodes()){
					return;
				}
				if(this._isInlineOrTextElement(endNode.lastChild)){
					this._rebuildBlock(endNode);
				}
				endNode = this._getClosestBlock(endNode.lastChild, "end", null);			
			}
			
			// Collect all selected block elements, which contain or can contain text.
			// Walk through DOM tree between start and end points of current selection.
			var origStartOffset = tempRange? tempRange.startOffset : 0,
				origEndOffset = tempRange? tempRange.endOffset : 0,
				origStartContainer = tempRange? tempRange.startContainer : null,
				origEndContainer = tempRange? tempRange.endContainer : null;		
			var info = this._collectNodes(startNode, endNode, commonAncestor, tempRange, nodes, 
					origStartContainer, origStartOffset, origEndContainer, origEndOffset, cmd);
			var nodesInfo = {nodes: nodes, groups: info.groups, cells: info.cells};
			cmd = cmd.toString();
			// Execution of specific action for each element from collection
			switch(cmd){
				//change direction
				case "mirror":
				case "ltr":
				case "rtl":
				//change alignment
				case "left":
				case "right":
				case "center":
				//explicit direction setting
				case "explicitdir":
					this._execDirAndAlignment(nodesInfo, cmd, arg);
					break;
				//before 'formatblock' native command
				case "prepareformat":
					this._prepareFormat(nodesInfo, arg);
					break;
				//after executing 'formatblock' native command
				case "formatblock":
					this._execFormatBlocks(nodesInfo, arg);
					break;				
				default: throw new Error("Command " + cmd + " isn't handled");
			}
			// Refine selection after changes
			if(tempRange){		
				tempRange.setStart(origStartContainer, origStartOffset);
				tempRange.setEnd(origEndContainer, origEndOffset);				
				sel = rangeapi.getSelection(this.editor.window, true);
				sel.removeAllRanges();
				sel.addRange(tempRange);
				//DL changed this.editor.onDisplayChanged();
				//this._onDisplayChanged();
			}
			return nodesInfo;
		},


		_collectNodes: function(startNode, endNode, commonAncestor, tempRange, nodes, origStartContainer, origStartOffset, origEndContainer, origEndOffset, cmd){
			// summary:
			//		Collect all selected block elements, which contain or can contain text.
			//		Walk through DOM tree between start and end points of current selection.
			var node = startNode, sibling, child, parent = node.parentNode, divs = [],
				firstSibling, lastSibling, groups = [], group = [], cells = [], curTD = this.editor.editNode;
			var saveNodesAndGroups = lang.hitch(this, function(x){
				nodes.push(x);
				group.push(x);
			});
			this._rebuildBlock(parent);
			while(true){
				if(this._hasTagFrom(node,this._tableContainers)){
					if(node.firstChild){
						parent = node;
						node = node.firstChild;
						continue;						
					}
				}else if(this._isBlockElement(node)){				
					var supLI = rangeapi.getBlockAncestor(node, /li/i, this.editor.editNode).blockNode;
					if(supLI && supLI !== node){
						node = supLI;
						parent = node.parentNode;
						continue;
					}
					if(!this._hasTag(node,"LI")){		
						if(node.firstChild){
							this._rebuildBlock(node);
							if(this._isBlockElement(node.firstChild) || this._hasTagFrom(node.firstChild,this._tableContainers)){
								parent = node;
								node = node.firstChild;
								continue;
							}
						}
					}
					if(this._hasTagFrom(node,this._lineTextArray)){
						saveNodesAndGroups(node);
					}
				}else if(this._isInlineOrTextElement(node) && !this._hasTagFrom(node.parentNode,this._tableContainers)){
					firstSibling = node;
					while(node){
						var nextSibling = node.nextSibling;
						if(this._isInlineOrTextElement(node)){
							lastSibling = node;						
							if(this._hasTag(node,"BR")){
								if(!(this._isBlockElement(parent) && node === parent.lastChild)){
									divs = this._repackInlineElements(firstSibling, lastSibling, parent);
									node = divs[divs.length-1];
									for(var nd = 0; nd < divs.length; nd++){
										saveNodesAndGroups(divs[nd]);
									}
									firstSibling = lastSibling = null;
									if(nextSibling && this._isInlineOrTextElement(nextSibling)){
										firstSibling = nextSibling;
									}
								}
							}
						}else if(this._isBlockElement(node)){
							break;
						}	
						node = nextSibling;
					}
					if(!firstSibling){
						continue;
					}
					divs = this._repackInlineElements(firstSibling, lastSibling, parent);
					node = divs[divs.length-1];
					for(var ind = 0; ind < divs.length; ind++){
						saveNodesAndGroups(divs[ind]);
					}
				}
				
				if(node === endNode){
					break;
				}
				if(node.nextSibling){
					node = node.nextSibling;
				}else if(parent !== commonAncestor){
					while(!parent.nextSibling){
						node = parent;
						parent = node.parentNode;
						if(parent === commonAncestor){
							break;
						}
					}
					if(parent !== commonAncestor && parent.nextSibling){
						node = parent.nextSibling;
						parent = parent.parentNode;
					}else{
						break;
					}
				}else{ 
					break;
				}
			}
			if(group.length){
				if(has("webkit") || curTD){
					groups.push(group);
				}else{
					groups.unshift(group);
				}
			}
			return {groups: groups, cells: cells};
		},


		_execDirAndAlignment: function(nodesInfo, cmd,arg){
			// summary:
			//		Change direction and/or alignment of each node from the given array.
			switch(cmd){
			//change direction
			case "mirror":
			case "ltr":
			case "rtl":
				array.forEach(nodesInfo.nodes, function(x){
					var style = domStyle.getComputedStyle(x),
						curDir = style.direction,
						oppositeDir = curDir == "ltr"? "rtl" : "ltr",
						realDir = (cmd != "mirror"? cmd : oppositeDir),
						curAlign = style.textAlign,
						marginLeft = isNaN(parseInt(style.marginLeft, 10))? 0 : parseInt(style.marginLeft, 10),
						marginRight = isNaN(parseInt(style.marginRight, 10))? 0 : parseInt(style.marginRight, 10);
					domAttr.remove(x,"dir");
					domAttr.remove(x,"align");					
					domStyle.set(x, {direction: realDir, textAlign: ""});
					if(this._hasTag(x,"CENTER")){
						return;
					}
					if(curAlign.indexOf("center") >= 0){
						domStyle.set(x,"textAlign","center");
					}
					if(this._hasTag(x,"LI")){
						this._refineLIMargins(x);
						var margin = curDir === "rtl"? marginRight : marginLeft; 
						var level = 0, tNode = x.parentNode, name;
						if(curDir != domStyle.get(tNode,"direction")){
							while(tNode !== this.editor.editNode){
								if(this._hasTagFrom(tNode,["OL","UL"])){
									level++;
								}
								tNode = tNode.parentNode;
							}
							margin -= this._getMargins(level);
						}
						var styleMargin = realDir == "rtl"? "marginRight" : "marginLeft";
						var cMargin = domStyle.get(x,styleMargin);
						var cIndent = isNaN(cMargin)? 0 : parseInt(cMargin, 10);
						domStyle.set(x,styleMargin,"" + (cIndent + margin) + "px");
						if(has("webkit")){
							if(curAlign.indexOf("center") < 0){
								domStyle.set(x, "textAlign", (realDir == "rtl"? "right" : "left"));
							}
						}else if(x.firstChild && x.firstChild.tagName){
							if(this._hasTagFrom(x.firstChild,this._lineStyledTextArray)){
								style = domStyle.getComputedStyle(x);
								align = this._refineAlignment(style.direction, style.textAlign);
								domStyle.set(x.firstChild, {direction : realDir, textAlign: align});
							}
						}										
					}else{
						if(realDir == "rtl" && marginLeft !== 0){
							domStyle.set(x, {marginLeft: "", marginRight: "" + marginLeft + "px"});
						}else if(realDir == "ltr" && marginRight !== 0){
							domStyle.set(x, {marginRight: "", marginLeft: "" + marginRight + "px"});
						}
					}
				},this);
				query("table",this.editor.editNode).forEach(function(table,idx,array){
					var dir = cmd;
					if(cmd === "mirror"){
						dir = domStyle.get(table,"direction") === "ltr"? "rtl" : "ltr";
					}
					var listTD = query("td",table), first = false, last = false;
					for(var i = 0; i < nodesInfo.cells.length; i++){
						if(!first && listTD[0] === nodesInfo.cells[i]){
							first = true;
						}else if(listTD[listTD.length-1] === nodesInfo.cells[i]){
							last = true;
							break;
						}
					}
					if(first && last){
						domStyle.set(table,"direction",dir);
						for(i = 0; i < listTD.length; i++){
							domStyle.set(listTD[i],"direction",dir);
						}
					}
				},this);
				break;
			//change alignment
			case "left":
			case "right":
			case "center":
				array.forEach(nodesInfo.nodes, function(x){
					if(this._hasTag(x,"CENTER")){
						return;
					}
					domAttr.remove(x,"align");
					domStyle.set(x,"textAlign",cmd);
					if(this._hasTag(x,"LI")){
						if(x.firstChild && x.firstChild.tagName){
							if(this._hasTagFrom(x.firstChild,this._lineStyledTextArray)){
								var style = domStyle.getComputedStyle(x),
									align = this._refineAlignment(style.direction, style.textAlign);
								domStyle.set(x.firstChild, "textAlign", align);
							}
						}										
					}					
				},this);
				break;
			//explicit direction setting
			case "explicitdir":
				array.forEach(nodesInfo.nodes, function(x){
					var style = domStyle.getComputedStyle(x),
						curDir = style.direction;
					domAttr.remove(x,"dir");										
					domStyle.set(x, {direction: curDir});
				},this);
				break;
			}		
		},

		_prepareFormat: function(nodesInfo, arg){
			array.forEach(nodesInfo.nodes, function(x){
				// In some cases Mozill'a native 'formatblock' command mistakely merges contents of list items.
				// For example, for list with three items, containing some text like "one", "two", "three" and first two items selected, 
				// after changing their format from "None" to "Paragraph" we get from <li>one</li><li>two<li> something like 
				// <li><p>Onetwo</p></li><li><br></li>. Problem can be solved by 'manual' formatting, 
				// so with given example we create <li><p>...</p></li> for each list item.
				if(has("mozilla")){
					if(this._hasTag(x,"LI")){
						if(x.firstChild && !this._isBlockElement(x.firstChild)){
							var div = x.ownerDocument.createElement(arg), sibling = x.firstChild;
							x.insertBefore(div, x.firstChild);
							while(sibling){
								div.appendChild(sibling);
								sibling = sibling.nextSibling;
							}
						}
						var indent = this._getLIIndent(x);
						domAttr.set(x,"tempIndent",indent);
					}						
				}
				if(has("webkit")){
					var styledSpan;
					// If "fomatblocks" command is executed for list items, which already contain some blocks,
					// webkit merges contents of items. For example, after calling "formatblocks" with argument "P"
					// for two items <ul><li><h3>Hello</h3></li><li><h3>World</h3></li></ul> we get one item 
					// <ul><li><p>Hello<br>World<p></li></ul>. To avoid this, we move contents of each block into 
					// its parent,delete empty blocks and save info about required format in some bogus spans with 
					// empty contents. Action, executed after native call, will recreate blocks in required format  
					// and remove bogus spans.
					// Webkit lose 'direction' and 'textAlign styles of reformatted blocks.
					// We save info about these styles in attributes of some bogus SPANs with empty contents.					
					// Action, executed after native call, will restore styles of these blocks and remove bogus spans. 
					var style = domStyle.getComputedStyle(x),curDir = style.direction,curAlign = style.textAlign;
					curAlign = this._refineAlignment(curDir, curAlign);
					var span = styledSpan? x.firstChild : domConstruct.create("span",{innerHTML: this.bogusHtmlContent},x,"first");
					domAttr.set(span,"bogusDir",curDir);
					if(curAlign !== ""){
						domAttr.set(span,"bogusAlign",curAlign);
					}
				}
			},this);			
		},
		
		_execFormatBlocks: function(nodesInfo, arg){
			array.forEach(nodesInfo.nodes, function(x){
				if(this._hasTagFrom(x, this._lineTextArray)){
					//FF adds empty text nodes or nodes, containing spaces, after last converted block
					if(this._hasTag(x.parentNode,"DIV") && x.parentNode !== this.editor.editNode){
						while(x.parentNode.lastChild){
							if(!(x.parentNode.lastChild.nodeType == 3 && lang.trim(x.parentNode.lastChild.nodeValue) === "" ||
									this._hasTag(x.parentNode.lastChild,"BR"))){
								break;
							}	
							x.parentNode.removeChild(x.parentNode.lastChild);
						}						
					}
					if(this._hasTag(x.parentNode,"DIV") && x.parentNode !== this.editor.editNode && x.parentNode.childNodes.length == 1){
						var	div = x.parentNode, 
							style = domStyle.getComputedStyle(div),
							align = this._refineAlignment(style.direction, style.textAlign);
						domStyle.set(x, {direction: style.direction, textAlign: align});
						var margin = style.direction === "rtl"? "marginRight" : "marginLeft";
						var marginVal = parseInt(domStyle.get(div,margin), 10);
						if(marginVal !== 0 && !isNan(marginVal)){
							domStyle.set(x,margin,marginVal);
						}
						div.parentNode.insertBefore(x, div);
						div.parentNode.removeChild(div);
					}
				}
				if(this._hasTag(x,"LI")){
					var indent = 0;
					if(domAttr.has(x,"tempIndent")){
						indent = parseInt(domAttr.get(x,"tempIndent"), 10);
						domAttr.remove(x,"tempIndent");
					}
					this._refineLIMargins(x);
					if(indent){
						this._recountLIMargins(x,indent);
					}
					while(x.childNodes.length > 1){
						if(!(x.lastChild.nodeType == 3 && lang.trim(x.lastChild.nodeValue) === "")){
							break;
						}	
						x.removeChild(x.lastChild);
					}						
					if(this._hasTagFrom(x.firstChild,this._lineStyledTextArray)){
						var style1 = domStyle.getComputedStyle(x);
						var align1 = this._refineAlignment(style1.direction, style1.textAlign);
						if(!has("mozilla") && !(has("ie") && this._hasTag(x,"LI"))){
							domStyle.set(x.firstChild, {direction : style1.direction, textAlign: align1});
						}
					}else if(this._hasTag(x.firstChild,"DIV")){
						var div1 = x.firstChild;
						while(div1.firstChild){
							x.insertBefore(div1.firstChild, div1);
						}
						x.removeChild(div1);
					}	
					// IE doesn't format list items with not formatted content into paragraphs 
					if(has("ie") && !this._hasTag(x.firstChild,"P") && arg === "<p>"){
						var p = domConstruct.create("p");
						var block = this._hasTagFrom(p.nextSibling,this._lineStyledTextArray)? p.nextSibling : x;
						while(block.firstChild){
							domConstruct.place(block.firstChild,p,"last");
						}
						domConstruct.place(p,x,"first");
						if(block !== x){
							x.removeChild(block);
						}
					}
				}	
				if(has("webkit")){
					// When "formatblocks" with argument "div" is executed for list items, containing blocks like <h1>
					// or <pre>, Safari loads contents of these blocks into newly created DIVs, and places these DIVs 
					// into the same list as next siblings of source items. For example, if we have something like
					// <li><h3>Hello</h3></li>, we get <li><br></li><div>Hello</div>. So we move contents of these DIV's
					// into items and set special attributes for future deleting.
					if(this._hasTag(x,"DIV")){
						if(domAttr.has(x,"tempRole")){
							return;
						}else if(this._hasTag(x.previousSibling,"LI")){
							while(x.firstChild){
								domConstruct.place(x.firstChild,x.previousSibling,"last");
							}
							domAttr.set(x,"tempRole",true);
							x = x.previousSibling;
						}
					}
					// Restore attributes and remove bogus elments
					var hasBogusSpan = false;
					if(domAttr.has(x.firstChild,"bogusDir")){
						hasBogusSpan = true;
						var dir = domAttr.get(x.firstChild,"bogusDir");
						domStyle.set(x,"direction",dir);
					}
					if(domAttr.has(x.firstChild,"bogusAlign")){
						hasBogusSpan = true;
						var align2 = domAttr.get(x.firstChild,"bogusAlign");
						domStyle.set(x,"textAlign",align2);
					}
					var tag;
					if(domAttr.has(x.firstChild,"bogusFormat")){
						hasBogusSpan = true;
						tag = domAttr.get(x.firstChild,"bogusFormat");
						var block1;
						if(tag.toUpperCase() !== "DIV"){
							block1 = domConstruct.create(tag,null,x.firstChild,"after");
							while(block1.nextSibling){
								domConstruct.place(block1.nextSibling,block1,"last");								
							}
						}else{
							block1 = x;
						}						
						if(has("safari") && this._hasTag(x.nextSibling,"DIV")){
							while(x.nextSibling.firstChild){
								domConstruct.place(x.nextSibling.firstChild,block1,"last");
							}
							domAttr.set(x.nextSibling,"tempRole","true");
						}
					}
					if(hasBogusSpan){
						x.removeChild(x.firstChild);
					}
					if(tag && this._hasTag(x, "LI")){
						var parent = x.parentNode.parentNode;
						if(this._hasTag(parent,tag)){
							domAttr.set(parent,"tempRole","true");
						}
					}
				}
			},this);
			// Safari in some cases put ito lists unnecessary divs. They already empty and marked with 'tempRole' attribute.  
			// Both Chrome and Safari create for each formatted list item its own list and place such lists 
			// into top-level block elements. In this method above, needed "styled" blocks are already recreated inside 
			// list items, so corresponding top-level elements become unnecessary. They already marked with 'tempRole' attribute.
			// Now all elements having 'tempRole' attribute should be removed.
			if(has("webkit")){
				query("*[tempRole]",this.editor.editNode).forEach(function(x,index,arr){
					while(x.lastChild){
						domConstruct.place(x.lastChild,x,"after");
					}
					x.parentNode.removeChild(x);
				},this);
			}			
		},
		
		_rebuildBlock: function(block){
			// summary:
			//		Finds a sequences of inline elements that are placed 
			//		within a top-level block element or have block siblings.
			//		Calls _repackInlneElements(), which moves this sequences 
			//		into newly created block.
			var node = block.firstChild, firstSibling, lastSibling;
			var hasOwnBlock = false;  
			while(node){
				if(this._isInlineOrTextElement(node) && !this._hasTagFrom(node,this._tableContainers)){
					hasOwnBlock = !this._hasTagFrom(block,this._lineTextArray);
					if(!firstSibling){
						firstSibling = node;
					}
					lastSibling = node;
				}else if(this._isBlockElement(node) || this._hasTagFrom(node,this._tableContainers)){
					if(firstSibling){
						this._repackInlineElements(firstSibling, lastSibling, block);
						firstSibling = null;
					}
					hasOwnBlock = true;
				}
				node = node.nextSibling;
			}
			if(hasOwnBlock && firstSibling){
				this._repackInlineElements(firstSibling, lastSibling, block);
			}
		},
		
		_repackInlineElements: function(firstSibling, lastSibling, parent){
			// summary:
			//		Moves sequences of inline elements into 
			//		newly created blocks
			// description:
			//		This method handles sequences of inline elements, which are recognized by the user as 
			//		separate line(s) of the text, but are not placed into their own block element. Text direction
			//		or alignment can't be set for such lines.
			//		Possibles cases: 
			//			a) sequence directly belongs to editor's editNode;
			//			b) sequence has block-level siblings;
			//			c) sequence has BR in the start or in the middle of it.
			//		For all these cases we create new block and move elements from the sequence into it.
			//		We try to preserve explicitly defined styles, which have effect on this line. In case of
			//		sequences, which directly belong to editNode, it is only direction of the text.
			var divs = [], div = parent.ownerDocument.createElement(this.blockMode), newDiv;
			var cssTxt = firstSibling.previousSibling && firstSibling.previousSibling.nodeType == 1? firstSibling.previousSibling.style.cssText : parent.style.cssText;
			var isEditNode = parent === this.editor.editNode;
			divs.push(div);
			firstSibling = parent.replaceChild(div,firstSibling);
			domConstruct.place(firstSibling,div,"after");
			if(isEditNode){
				domStyle.set(div,'direction',domStyle.get(this.editor.editNode,"direction"));
			}else{
				div.style.cssText = cssTxt;	
			}
			for(var sibling = firstSibling; sibling;){
				var tSibling = sibling.nextSibling;
				if(this._isInlineOrTextElement(sibling)){
					if(this._hasTag(sibling,"BR") && sibling !== lastSibling){
						newDiv = parent.ownerDocument.createElement(this.blockMode);
						divs.push(newDiv);
						sibling = parent.replaceChild(newDiv,sibling);
						domConstruct.place(sibling,newDiv,"after");
						if(isEditNode){
							domStyle.set(newDiv,'direction',domStyle.get(this.editor.editNode,"direction"));
						}else{
							newDiv.style.cssText = cssTxt;	
						}
					}
					if((this._hasTag(sibling,"BR") || sibling.nodeType == 8) && !div.hasChildNodes())
						div.innerHTML = this.bogusHtmlContent;
					if(this._hasTag(sibling,"BR") && has("ie")){
						sibling.parentNode.removeChild(sibling);
					}else if(sibling.nodeType != 8){
						div.appendChild(sibling);
					}else{
						sibling.parentNode.removeChild(sibling);
					}
					if(sibling.nodeType == 3 && sibling.previousSibling && sibling.previousSibling.nodeType == 3){
						sibling.previousSibling.nodeValue += sibling.nodeValue;
						sibling.parentNode.removeChild(sibling);
					}
					if(newDiv){
						div = newDiv;
						newDiv = null;
					}
				}
				if(sibling === lastSibling){
					break;
				}
				sibling = tSibling;
			}
			return divs;						
		},

		_preFilterNewLines: function(html){
			var result = html.split(/(<\/?pre.*>)/i), inPre = false;
			for(var i = 0; i < result.length; i++){
				if(result[i].search(/<\/?pre/i) < 0 && !inPre){
					result[i] = result[i].replace(/\n/g,"").replace(/\t+/g,"\xA0").replace(/^\s+/,"\xA0").replace(/\xA0\xA0+$/,"");
				}else if(result[i].search(/<\/?pre/i) >= 0){
					inPre = !inPre;
				}
			}
			return result.join("");
		},
		
		_refineAlignment: function(dir, align){
			// summary:
			//		Refine the value, which should be used as textAlign style.
			// description:
			//		This method allows to keep textAlign styles only for cases,
			//		when it is defined explicitly.
			if(align.indexOf("left") >= 0 && dir == "rtl"){
				align = "left";
			}else if(align.indexOf("right") >= 0 && dir == "ltr"){
				align = "right";
			}else if(align.indexOf("center") >= 0){
				align = "center";
			}else{ 
				align = "";
			}
			return align;
		},

		_refineLIMargins: function(node){
			// summary:
			//		Line items, orientation of which is differ from their parents,
			//		arn't shown correctly by all browsers.
			//		Problem is solved by adding corresponding margins.
			var liDir = domStyle.get(node,"direction"),
				pDir = domStyle.get(node.parentNode,"direction"),
				level = 0, tNode = node.parentNode, name, style, offs, val;
			if(has("webkit")){
				pDir = domStyle.get(this.editor.editNode,"direction");
			}
			while(tNode !== this.editor.editNode){
				if(this._hasTagFrom(tNode,["OL","UL"])){
					level++;
				}
				tNode = tNode.parentNode;
			}
			domStyle.set(node,"marginRight","");
			domStyle.set(node,"marginLeft","");
			style = liDir == "rtl"? "marginRight" : "marginLeft";
			offs = this._getMargins(level);
			val = "" + offs + "px";
			if(liDir != pDir){
				domStyle.set(node,style,val);
			}
		},
		
		_getMargins: function(level){
			if(level === 0){
				return 0;
			}
			var margin = 35;
			if(has("mozilla")){
				margin = 45;
			}else if(has("ie")){
				margin = 25;
			}
			return margin + (level-1)*40;
		},
		
		_recountLIMargins: function(node, addValue){
			var liDir = domStyle.get(node,"direction"), pDir = domStyle.get(node.parentNode,"direction");
			var margin = liDir == "rtl"? "marginRight" : "marginLeft";
			var valPx = domStyle.get(node,margin);
			var val = (isNaN(parseInt(valPx, 10))? 0 : parseInt(valPx, 10)) + (addValue? addValue : 0);
			if(node.firstChild && node.firstChild.nodeType == 1){
				valPx = domStyle.get(node.firstChild,margin);
				val += isNaN(parseInt(valPx, 10))? 0 : parseInt(valPx, 10);
				domStyle.set(node.firstChild, {marginLeft: "", marginRight: ""});
			}			
			if(liDir != pDir){
				val -= this._getMargins(this._getLILevel(node));
			}
			var parentMargin = this._getListMargins(node);
			if(parentMargin){
				for(var i = 0; i < parentMargin/40; i++){
					var newList = domConstruct.create(this._tag(node.parentNode),null,node,"before");
					domConstruct.place(node,newList,"last");
				}
			}
			if(liDir != pDir){
				val += this._getMargins(this._getLILevel(node));
			}							
			if(val){
				domStyle.set(node,margin, "" + (val) + "px");
			}
		},
		
		_getLILevel: function(node){
			var parent = node.parentNode;
			var level = 0;
			while(this._hasTagFrom(parent,["UL","OL"])){
				level++;
				parent = parent.parentNode;
			}
			return level;
		},

		_getLIIndent: function(node){
			var parent = node.parentNode,
				liDir = domStyle.get(node,"direction"), pDir = domStyle.get(parent,"direction"),
				margin = liDir === "rtl"? "marginRight" : "marginLeft";
			var marginVal = this._getIntStyleValue(node,margin);
			var liMargin = liDir === pDir? 0 : this._getMargins(this._getLILevel(node));
			return marginVal - liMargin;
				
		},
		
		_getListMargins: function(node){
			var parent = node.parentNode;
			var margin, val = 0, valPx;
			while(this._hasTagFrom(parent,["UL","OL"])){
				var pDir = domStyle.get(parent,"direction");
				margin = pDir == "rtl"? "marginRight" : "marginLeft";
				valPx = domStyle.get(parent,margin);
				val += isNaN(parseInt(valPx, 10))? 0 : parseInt(valPx, 10);
				parent = parent.parentNode;
			}
			return val;			
		},
		
		_tag: function(node){
			return node && node.tagName && node.tagName.toUpperCase();
		},
		
		_hasTag: function(node,tag){
			return (node && tag && node.tagName && node.tagName.toUpperCase() === tag.toUpperCase());
		},

		_hasStyledTextLineTag: function(node){
			return this._hasTagFrom(node, this._lineStyledTextArray);
		},
		
		_hasTagFrom: function(node,arr){
			return node && arr && node.tagName && array.indexOf(arr, node.tagName.toUpperCase()) >= 0;
		},
		
		_getParentFrom: function(node,arr){
			if(!node || !arr || !arr.length){
				return null;
			}
			var x = node;
			while(x !== this.editor.editNode){
				if(this._hasTagFrom(x,arr)){
					return x;
				}
				x = x.parentNode;
			}
			return null;
		},

		_isSimpleInfo: function(info){
			// summary:
			//	returns true, if all nodes, for which current action should be executed,
			//  may be handled in the same time (so, all nodes are in the same group)
			return !info || info.groups.length < 2;
		},
		
		_isListTypeChanged: function(node, cmd){
			// summary:
			//	Returns true, if command "insertorderedlist" executed for item from unordered list and 
			//	if command "insertunorderedlist" executed for item from ordered list
			if(!this._hasTag(node,"LI")){
				return false;
			}
			var parent = node.parentNode;
			return (this._hasTag(parent,"UL") && cmd === "insertorderedlist" || this._hasTag(parent,"OL") && cmd === "insertunorderedlist");
		},
		
		_getIntStyleValue: function(node, style){
			var val = parseInt(domStyle.get(node,style), 10);
			return isNaN(val)? 0 : val;
		},
		
		_mergeLists: function(){
			// summary:
			//	In some cases (like "formatblocks" for list items) lists of the the same type 
			//	are created as a siblings inside the same parent. These  lists should be merged.
			var sel = rangeapi.getSelection(this.editor.window);
			var reselect = sel && sel.rangeCount > 0;
			var range, startContainer, startOffset, endContainer, endOffset;
			if(reselect){
				range = sel.getRangeAt(0).cloneRange();
				startContainer = range.startContainer;
				startOffset = range.startOffset;
				endContainer = range.endContainer;
				endOffset = range.endOffset;
			}
			var wasMerged = false;
			query("ul,ol",this.editor.editNode).forEach(function(x,ind,arr){
				if(domAttr.has(x,"tempRole")){
					x.parentNode.removeChild(x);
					return;
				}
				var sibling = x.nextSibling;
				while(this._hasTag(sibling,this._tag(x))){
					while(sibling.firstChild){
						domConstruct.place(sibling.firstChild,x,"last");
						wasMerged = true;
					}
					domAttr.set(sibling,"tempRole","true");
					sibling = sibling.nextSibling;
				}					
			},this);
			if(reselect && wasMerged){
				// Restore selection
				sel.removeAllRanges();
				try{
					range.setStart(startContainer, startOffset);
					range.setEnd(endContainer, endOffset);
					sel.addRange(range);
				}catch(e){
				}				
			}			
		},
		
		_cleanLists: function(){
			// summary:
			//	Removes remaining bogus elements, creating by the method _prepareLists()
			if(has("webkit")){
				query("table", this.editor.editNode).forEach(function(x,ind,arr){
					var sibling = x.nextSibling;
					if(this._hasTag(sibling,"UL") && domAttr.get(sibling,"tempRole") === "true"){
						sibling.parentNode.removeChild(sibling);
					}
				},this);
				query("li[tempRole]", this.editor.editNode).forEach(function(x,ind,arr){
					if(x.parentNode.childNodes.length == 1){
						x.parentNode.parentNode.removeChild(x.parentNode);
					}else{
						x.parentNode.removeChild(x);
					}
				});
			}
			var sel = rangeapi.getSelection(this.editor.window);
			var reselect = sel && sel.rangeCount > 0;
			var range, startContainer, startOffset, endContainer, endOffset;
			if(reselect){
				range = sel.getRangeAt(0).cloneRange();
				startContainer = range.startContainer;
				startOffset = range.startOffset;
				endContainer = range.endContainer;
				endOffset = range.endOffset;
			}
			var wasMoved = false;
			query("span[bogusDir]", this.editor.editNode).forEach(function(x,ind,arr){
				var node = x.firstChild, sibling = node;
				if(node.nodeType == 1){
					while(node){
						sibling = node.nextSibling;
						domConstruct.place(node,x,"after");
						wasMoved = true;
						node = sibling;
					}
				}
				x.parentNode.removeChild(x);
			},this);
			if(reselect && wasMoved){
				// Restore selection
				sel.removeAllRanges();
				try{
					range.setStart(startContainer, startOffset);
					range.setEnd(endContainer, endOffset);
					sel.addRange(range);
				}catch(e){
				}				
			}
		}
	});
	return BidiSupportTextarea;
});