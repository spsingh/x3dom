/*
 * X3DOM JavaScript Library
 * http://x3dom.org
 *
 * (C)2009 Fraunhofer Insitute for Computer
 *         Graphics Reseach, Darmstadt
 * Dual licensed under the MIT and GPL.
 *
 * Based on code originally provided by
 * Philip Taylor: http://philip.html5.org
 */
 

 //a small AttributeArray wrapper class
var AttributeArray = function(numComponents, numBitsPerComponent, numBitsPerComponentPerLevel, readOffset) {
	//---------------------------------
	//static general information
	this.numComponents 	   	 = numComponents;	
	this.numBitsPerComponent = numBitsPerComponent;	
	
	//---------------------------------
	//static refinement information
	this.numBitsPerComponentPerLevel = numBitsPerComponentPerLevel;
	this.readOffset	     			 = readOffset;	
	
	//---------------------------------
	//dynamic refinement information
	this.componentMask   	 = [];
	this.componentLeftShift  = [];
	this.precisionOffset 	     = 0;
	
	this.bufferView		 = {}; //renewed on every refinement due to changing ownership
}


 x3dom.BitComposerSync = function() {
	var self = this;
	
	this.refinementCallback   		= {};	
	this.refinementDataURLs   		= [];	
	
	this.nextLevelProcess  	  		= 0;	
	this.downloadedRefinementLevels = [];
									
	this.useDebugOutput 			= false;
	
	this.interleavedMode 			= false;

	//list of registered attribute arrays
	this.attribArrays 				= [];

	//views on the refinement buffers
	this.refinementBufferViews 		= [];

	//size in bytes of a single element of the refinement buffers
	this.strideReading 				= 0;
	
	//number of refinements that have already been processed
	this.refinementsDone 			= 0;
	
	this.refinementInProcess		= false;
 };
 
 
 x3dom.BitComposerSync.prototype.toggleDebugOutput = function(flag) {
	this.useDebugOutput = flag;
 };


 x3dom.BitComposerSync.prototype.run = function(numAttributeComponents, numAttributeBitsPerComponent,
											    numAttributeBitsPerLevel, refinementDataURLs, refinementCallback,
												attributeWriteOffset, stride) {	
	var self = this;
	var i, j, off;
	var attributeArrayBuffer;
	var numBitsPerElement;

	if (numAttributeBitsPerComponent.length >   0 								&&		
		numAttributeBitsPerComponent.length === numAttributeComponents.length 	&&
		numAttributeBitsPerComponent.length === numAttributeBitsPerLevel.length	  ) {
		
		this.refinementCallback = refinementCallback;
		this.refinementDataURLs = refinementDataURLs;
		
		off = 0;
		for (i = 0; i < numAttributeBitsPerComponent.length; ++i) {
			this.attribArrays[i] = new AttributeArray(numAttributeComponents[i],
												      numAttributeBitsPerComponent[i],
												      numAttributeBitsPerLevel[i] / numAttributeComponents[i],
												      off);			
			off += numAttributeBitsPerLevel[i];			
		}
	
		//guess this.strideReading by checking the number of bits per refinement
		//usually, we expect this to be an exact multiple of 8, as one doesn't want to waste space in the encoded data
		this.strideReading = Math.ceil(off / 8);
	
		//if the offset and stride parameters are given, assume a single, interleaved output array
		if (attributeWriteOffset && stride) {
			this.interleavedMode = true;
		}

		//send priority-based requests for all refinement levels to the download manager
		for (i = 0; i < refinementDataURLs.length; ++i) {
		    x3dom.DownloadManager.get(this.refinementDataURLs[i],
									  function(response){ self.refinementDataDownloaded(response); },
									  i);
		}		
	} else {
		 x3dom.debug.logError('Unable to initialize bit composer: the given attribute parameter arrays are not of the same length.');
	}	
 };
 
 
 x3dom.BitComposerSync.prototype.tryNextRefinement = function(attributeArrayBuffers) {
	if (!this.refinementInProcess) {
		//check if the next level was already downloaded
		if (this.downloadedRefinementLevels.length && this.downloadedRefinementLevels[0] === this.nextLevelProcess) {		
			this.downloadedRefinementLevels.shift();
			this.nextLevelProcess++;
			
			this.refineAttributeData(this.refinementBufferViews[this.refinementsDone]);
			
			if (this.useDebugOutput) {
				x3dom.debug.logInfo('Refinement request processed! ' + this.downloadedRefinementLevels.length +
									' jobs left.');
			}
		}
		//postpone refinement request until the matching data was downloaded
		else if (this.nextLevelProcess < this.refinementDataURLs.length) {		
			if (this.useDebugOutput) {
				x3dom.debug.logInfo('Refinement request postponed. '  + this.downloadedRefinementLevels.length +
									' jobs left.');
			}
		}
		//no refinements left - we're done!
		else {
			if (this.useDebugOutput) {
				x3dom.debug.logInfo('No refinements left to process!');			
			}
		}
	}
 },
 
 
 x3dom.BitComposerSync.prototype.refinementDataDownloaded = function(data) {
	var i, lvl;

	if (data.arrayBuffer) {
		//find level of the returned data
		for (i = 0; i < this.refinementDataURLs.length; ++i) {
			if (data.url === this.refinementDataURLs[i]) {
				break;
			}
		}

		lvl = i;
		
		if (lvl < this.refinementDataURLs.length) {
			if (this.useDebugOutput) {
				x3dom.debug.logInfo('Refinement level ' + i + ' has been loaded!');
			}
						
			switch (this.strideReading) {
				case 4 :
					this.refinementBufferViews[lvl] = new Uint32Array(data.arrayBuffer);
					break;                                           
				case 2 :                                             
					this.refinementBufferViews[lvl] = new Uint16Array(data.arrayBuffer);
					break;                                           
				case 1 :                                             
					this.refinementBufferViews[lvl] = new Uint8Array(data.arrayBuffer);
					break;
				default:			
					x3dom.debug.logError('Refinement data not accepted: this.strideReading was found to be ' + this.strideReading +
										 ' bytes, but must be set to 1, 2 or 4 to apply refinement data.');
			}
			
			this.downloadedRefinementLevels.push(lvl);
			this.downloadedRefinementLevels.sort(function(a, b) { return a - b; });
			
			//if this is the first call, create the attribute array buffers
			if (!this.refinementsDone) {
				for (i = 0; i < this.attribArrays.length; ++i) {
					/*
					if (this.interleavedMode) {
						//in interleaved mode, all attributeArrays refer to the same buffer
						if (i === 0) {
							numBitsPerElement = 0;
							for (j = 0; j < this.attribArrays.length; ++j) {
								numBitsPerElement += this.attribArrays[i].numBitsPerComponent * this.attribArrays[i].numComponents;
							}
							
							attributeArrayBuffer = new ArrayBuffer((numBitsPerElement / 8) * this.refinementBufferViews[this.refinementsDone].length);
						}
						else {
							attributeArrayBuffer = this.attribArrays[0].bufferView.buffer;
						}
					}
					else {
					*/					
						numBitsPerElement    = this.attribArrays[i].numBitsPerComponent * this.attribArrays[i].numComponents;
						attributeArrayBuffer = new ArrayBuffer((numBitsPerElement / 8) * this.refinementBufferViews[lvl].length);
					//}
					
					switch (this.attribArrays[i].numBitsPerComponent) {						
						case 32 :
							this.attribArrays[i].bufferView = new Uint32Array(attributeArrayBuffer);
							break;
						case 16 :
							this.attribArrays[i].bufferView = new Uint16Array(attributeArrayBuffer);
							break;
						case 8 :
							this.attribArrays[i].bufferView = new Uint8Array(attributeArrayBuffer);
							break;
						default:
							x3dom.debug.logError('Unable to start refinement: no valid value (' + this.attribArrays[i].numBitsPerComponent +
												 + ' instead of 8, 16 or 32) set for numBitsPerComponent of attribute array ' + i + '.');
					}
				}
			}

			this.tryNextRefinement();
				
			//@todo: check!
			/*if (lvl === (this.refinementDataURLs.length - 1)) {
				while (this.refinementsDone < this.refinementDataURLs.length) {
					this.tryNextRefinement();
				}
			}*/
		}
		else {
			x3dom.logError('Error when enqueueing refinement data: no level with the given URL could be found.');
		}
	}
	else {
		x3dom.debug.logError('Unable to use downloaded refinement data: no ArrayBuffer data recognized.');
	}
 }
 
 
 x3dom.BitComposerSync.prototype.refineAttributeData = function(refinementBufferView) {
	var start = new Date();
	
	this.refinementInProcess = true;
	
	var i, j, c,
		n, m, nc,
		attrib, attributeLeftShift;
		
	var dataChunk;
	
	m = this.attribArrays.length;
	
	for (i = 0; i < m; ++i) {
		attrib = this.attribArrays[i];
		nc	   = attrib.numComponents;
		
		attributeLeftShift 	   = (this.strideReading * 8) - attrib.readOffset - attrib.numBitsPerComponentPerLevel * nc;	
		attrib.precisionOffset = attrib.numBitsPerComponent - attrib.numBitsPerComponentPerLevel -
								 (this.refinementsDone * attrib.numBitsPerComponentPerLevel);
							
		for (c = 0; c < nc; ++c) {
			attrib.componentLeftShift[c] = attributeLeftShift + (nc - c - 1) * attrib.numBitsPerComponentPerLevel;
			
			attrib.componentMask[c]    = 0 | (Math.pow(2, attrib.numBitsPerComponentPerLevel) - 1);
			attrib.componentMask[c]  <<= attrib.componentLeftShift[c];
		}
	}
	
	n = refinementBufferView.length;	
		
	var writeTarget,
		baseIdx,
		idx;
		
	var component;
	var self = this;
/*
	for (j = 0; j < m; ++j) {
	//split-up function	
	//j = 0;
	//(function() {
		attrib 		= self.attribArrays[j];
	
		nc		    = attrib.numComponents;
		writeTarget = attrib.bufferView;
		baseIdx		= 0;
		
		for (i = 0; i < n; ++i) {		
			dataChunk = refinementBufferView[i];
			
			for (c = 0; c < nc; ++c) {				
				component = dataChunk & attrib.componentMask[c];			
				
				component >>>= attrib.componentLeftShift[c];
				component  <<= attrib.precisionOffset;
							
				idx 			  = baseIdx + c;				
				writeTarget[idx] |= component;				
			}
		
			baseIdx += nc;
		}
			
		// ++j;
		
		// if (j < m) {
			// setTimeout(arguments.callee, 0);
		// }
		// else {
			// self.finishedRefinement(start);
		// }
	// })();
	}
	this.finishedRefinement(start);
	*/
	/*
	// BEGIN INLINED LOOP
	//{	
	(function(){
		//j = 0:		
		attrib = self.attribArrays[0];
	
		nc		    = attrib.numComponents;
		writeTarget = attrib.bufferView;
		baseIdx		= 0;
		
		for (i = n; --i; ) {		
			dataChunk = refinementBufferView[i];
			
			for (c = 0; c < nc; ++c) {
				component = dataChunk & attrib.componentMask[c];			
				
				component >>>= attrib.componentLeftShift[c];
				component  <<= attrib.precisionOffset;
				
				idx 			  = baseIdx + c;
				writeTarget[idx] |= component;
			}
			
			baseIdx += nc;
		}		
	})();
	
	(function(){
		//j = 1:
		attrib = self.attribArrays[1];
	
		nc		    = attrib.numComponents;
		writeTarget = attrib.bufferView;
		baseIdx		= 0;
		
		for (i = n; --i; ) {		
			dataChunk = refinementBufferView[i];
			
			for (c = 0; c < nc; ++c) {
				component = dataChunk & attrib.componentMask[c];			
				
				component >>>= attrib.componentLeftShift[c];
				component  <<= attrib.precisionOffset;
				
				idx 			  = baseIdx + c;
				writeTarget[idx] |= component;
			}
			
			baseIdx += nc;
		}
		
		self.finishedRefinement(start);
	})();
	//}
	//END INLINED LOOP
  */
  //BEGIN OPTIMIZED LOOP
	//{		
		var writeTargetNor = this.attribArrays[0].bufferView;
		var writeTargetPos = this.attribArrays[1].bufferView;
		var norPrecOff	   = this.attribArrays[0].precisionOffset;
		var posPrecOff	   = this.attribArrays[1].precisionOffset;
		var idxNor   	   = 0;
		var idxPos   	   = 0;
		
		var n1, n2, p1, p2, p3;
		
		for (i = 0; i < n; ++i) {
      dataChunk = refinementBufferView[i];
			
			n1   = (dataChunk & 0x80) >>> 7;
			n1 <<= norPrecOff;
			
			n2   = (dataChunk & 0x40) >>> 6;
			n2 <<= norPrecOff;
			
			writeTargetNor[idxNor++] |= n1;
			writeTargetNor[idxNor++] |= n2;
			
			p1   = (dataChunk & 0x30) >>> 4;
			p1 <<= posPrecOff; 
			
			p2   = (dataChunk & 0x0C) >>> 2;
			p2 <<= posPrecOff;
			
			p3 	 = (dataChunk & 0x03);
			p3 <<= posPrecOff;
			
			writeTargetPos[idxPos++] |= p1;
			writeTargetPos[idxPos++] |= p2;
			writeTargetPos[idxPos++] |= p3;
		}
  this.finishedRefinement(start);
	//}
	//END OPTIMIZED LOOP
  
	//this.finishedRefinement(start);
	
}


x3dom.BitComposerSync.prototype.finishedRefinement = function(start) {	
	var i;
	
	//'pack' the buffers
	var attributeArrayBuffers = [];
		
	for (i = 0; i < this.attribArrays.length; ++i) {
		attributeArrayBuffers[i] = this.attribArrays[i].bufferView.buffer;		
	}	
	
	x3dom.debug.logInfo('--- I needed ' + (Date.now() - start) + ' ms to do the job. ---');
	
	this.refinementCallback({attributeArrayBuffers : attributeArrayBuffers});
	
	this.refinementInProcess = false;
	++this.refinementsDone;	
	this.tryNextRefinement();
}
