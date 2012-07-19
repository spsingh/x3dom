var out = window.document.getElementById('output');

var start_time;

var decode_ms = 0;

var start_drawing = false;


//---
const UseInterleavedOutput = false;
		
const StrideInBits = 96;

var glContext;

var glBuffers = {	//object data buffers on the gpu
  positions: {},
  normals:   {}
};

var positionAttribLocation;
var normalAttribLocation;
      
var numArrayElements = 0;

var refinedLevels = 0;
//---


function UpdateDecode(ms) {
  decode_ms += ms;
}


function UpdateTotal(ms) {
  start_drawing = true;
  out.innerHTML = "Decode time: " + decode_ms +
      " ms, Total time: " + ms + " ms";
}

		 
var refinementURLs = [ 'data/refinement00.bin',
					   'data/refinement01.bin',
					   'data/refinement02.bin',
					   'data/refinement03.bin',
					   'data/refinement04.bin',
					   'data/refinement05.bin',
					   'data/refinement06.bin',
					   'data/refinement07.bin' ];

             
function LoaderExample() { }


LoaderExample.prototype = {


num_indices : 0,


load : function(gl)
{
  this.xform = new SglTransformStack();
  this.angle = 0.0;

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  var simpleVsrc = id("SIMPLE_VERTEX_SHADER").text;
  var simpleFsrc = id("SIMPLE_FRAGMENT_SHADER").text;
  var program = new Program(gl, [vertexShader(gl, simpleVsrc),
                                 fragmentShader(gl, simpleFsrc)]);
  this.program = program;
  program.use();
  
  //-> original code:
  //program.enableVertexAttribArrays(BUDDHA_ATTRIB_ARRAYS);
  //-
	//-> replaced with:
  positionAttribLocation = gl.getAttribLocation(this.program.handle_, 'a_position');
  normalAttribLocation   = gl.getAttribLocation(this.program.handle_, 'a_normal');
  
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(normalAttribLocation);
  
  glBuffers.positions = gl.createBuffer();
  glBuffers.normals   = gl.createBuffer();
  
  glContext = gl;
  //-

  //----
  
  bitComposer = new x3dom.BitComposer('../../../src/util/BitComposerWorker.js');

  //bitComposer.toggleDebugOutput(true);
  //x3dom.DownloadManager.toggleDebugOutput(true);

  if (UseInterleavedOutput) {
    bitComposer.run([2,   3], 					        //components
                    [16, 16], 					        //attribute bits for each component
                    [2,   6], 					        //bits per refinement level for all components
                    refinementURLs,			        //URLs for the files of the refinement levels
                    refinementFinishedCallback, //callback, executed on refinement
                    [64, 0],					          //write offset in bits (interleaved output)
                    StrideInBits);			        //write stride in bits (interleaved output)
  }
  else {
    bitComposer.run([2,   3], 					         //components
                    [16, 16], 					         //attribute bits for each component
                    [2,   6], 					         //bits per refinement level for all components
                    refinementURLs,			         //URLs for the files of the refinement levels
                    refinementFinishedCallback); //callback, executed on refinement
  }  
},


update : function(gl, dt)
{
  this.angle += 90.0 * dt;
},


draw : function(gl)
{
  // Move some of this (viewport, projection) to a reshape function.
  var w = this.ui.width;
  var h = this.ui.height;

  gl.clearColor(0.2, 0.2, 0.6, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  gl.viewport(0, 0, w, h);

  this.xform.projection.loadIdentity();
  this.xform.projection.perspective(sglDegToRad(60.0), w/h, 0.1, 100.0);

  this.xform.view.loadIdentity();
  this.xform.view.lookAt(0.0, 2.0, 3.0,
                         0.0, 0.0, 0.0,
                         0.0, 1.0, 0.0);

  this.xform.model.loadIdentity();
  this.xform.model.rotate(sglDegToRad(this.angle), 0.0, 1.0, 0.0);

  gl.uniformMatrix4fv(this.program.set_uniform["u_mvp"], false,
                      this.xform.modelViewProjectionMatrix);
                      
  //-> original code:
  //gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
  //program.vertexAttribPointers(BUDDHA_ATTRIB_ARRAYS);
  //gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
  //gl.drawElements(gl.TRIANGLES, this.num_indices, gl.UNSIGNED_SHORT, 0);
  //-
	//-> replaced with:
  if (UseInterleavedOutput) {
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.positions);
    gl.vertexAttribPointer(positionAttribLocation, 3, gl.UNSIGNED_SHORT, true, 6*2, 0  );
    gl.vertexAttribPointer(normalAttribLocation,   2, gl.UNSIGNED_SHORT, true, 6*2, 4*2);							
  }
  else {
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.positions);
    gl.vertexAttribPointer(positionAttribLocation, 3, gl.UNSIGNED_SHORT, true, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.normals);
    gl.vertexAttribPointer(normalAttribLocation, 2, gl.UNSIGNED_SHORT, true, 0, 0);
  }
  
  gl.drawArrays(gl.TRIANGLES, 0, numArrayElements);
  //-  
}


};


function refinementFinishedCallback(attributeData) {  
  console.log('=> Client received refined data for level ' + refinedLevels + '!');
          
  var normalBuffer,
      coordBuffer;
  
  if (UseInterleavedOutput) {					
    coordBuffer  = new Uint16Array(attributeData.attributeArrayBuffers[0]);
  }
  else {
    normalBuffer = new Uint16Array(attributeData.attributeArrayBuffers[0]);
    coordBuffer  = new Uint16Array(attributeData.attributeArrayBuffers[1]);
  }
  
  if (UseInterleavedOutput) {
    numArrayElements = (coordBuffer.length * Uint16Array.BYTES_PER_ELEMENT * 8) / StrideInBits;
  }
  else {
    numArrayElements = coordBuffer.length / 3;
  }
  
  ++refinedLevels;
  
  //upload the VBO data to the GPU
  glContext.bindBuffer(glContext.ARRAY_BUFFER, glBuffers.positions);
  glContext.bufferData(glContext.ARRAY_BUFFER, coordBuffer, glContext.STATIC_DRAW);
  
  if (!UseInterleavedOutput) {
    glContext.bindBuffer(glContext.ARRAY_BUFFER, glBuffers.normals);
    glContext.bufferData(glContext.ARRAY_BUFFER, normalBuffer, glContext.STATIC_DRAW);
  }

  //enjoy it for a few secs :-)
  //sleep(1000);

  if (refinedLevels === 8) {
    UpdateTotal(Date.now() - start_time);
  }
  
  bitComposer.refine(attributeData.attributeArrayBuffers);
}
    
    
start_time = Date.now();


sglRegisterCanvas("webgl_canvas", new LoaderExample(), 60.0);
