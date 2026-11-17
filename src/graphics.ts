import { OrbitCamera, focalLength } from "./camera.js";
export type Point = [number, number, number];
type RGB = [number, number, number];
const colors = new Map<string, RGB>();
function rgb(hex: string): RGB {
  let c = colors.get(hex);
  if (!c) {
    const v = parseInt(hex, 16);
    c = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    colors.set(hex, c);
  }
  return c;
}
export class Mesh {
  data: number[] = [];
  lots: { start: number; end: number; id: number }[] = [];
  tri(a: Point, b: Point, c: Point, color: string, light = 1) {
    const v = rgb(color);
    for (const p of [a, b, c]) this.data.push(...p, v[0] * light, v[1] * light, v[2] * light);
  }
  quad(a: Point, b: Point, c: Point, d: Point, color: string, light = 1) {
    this.tri(a, b, c, color, light);
    this.tri(a, c, d, color, light);
  }
  flat(x: number, z: number, w: number, d: number, y: number, c: string) {
    this.quad([x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d], c);
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: string) {
    const a: Point = [x, y + h, z],
      b: Point = [x + w, y + h, z],
      e: Point = [x + w, y + h, z + d],
      f: Point = [x, y + h, z + d];
    this.quad(a, b, e, f, c);
    this.quad(f, e, [x + w, y, z + d], [x, y, z + d], c, 0.82);
    this.quad(b, e, [x + w, y, z + d], [x + w, y, z], c, 0.69);
    this.quad(a, b, [x + w, y, z], [x, y, z], c, 0.77);
    this.quad(a, f, [x, y, z + d], [x, y, z], c, 0.92);
  }
  cone(x: number, y: number, z: number, r: number, h: number, c: string, sides = 7, top = 0) {
    for (let i = 0; i < sides; i++) {
      const a = (i * 2 * Math.PI) / sides,
        b = ((i + 1) * 2 * Math.PI) / sides;
      const p: Point = [x + r * Math.cos(a), y, z + r * Math.sin(a)],
        q: Point = [x + r * Math.cos(b), y, z + r * Math.sin(b)],
        u: Point = [x + top * Math.cos(b), y + h, z + top * Math.sin(b)],
        v: Point = [x + top * Math.cos(a), y + h, z + top * Math.sin(a)];
      this.quad(p, q, u, v, c, 0.83 + 0.14 * Math.cos(a + 2));
      if (top) this.tri(u, v, [x, y + h, z], c);
    }
  }
}
type BufferMesh = { buffer: WebGLBuffer; count: number };
const vertex = `#version 300 es
layout(location=0) in vec3 pos;
layout(location=1) in vec3 color;
layout(location=2) in float lot;
uniform vec4 camera, lens;
uniform vec2 tilt;
uniform int pass;
out vec3 col;
out vec3 sun;
out float depth;
flat out int parcel;
void main(){
  vec2 p=pos.xz-camera.xy;
  float right=dot(p,vec2(camera.z,-camera.w));
  float forward=dot(p,camera.wz);
  float up=pos.y*tilt.y-forward*tilt.x;
  depth=lens.w-forward*tilt.y-pos.y*tilt.x;
  // Orthographic coordinates in sunlight space. Depth increases away from the sun.
  vec3 q=pos-vec3(18.,0.,18.);
  sun=vec3(dot(q,vec3(.8,0.,-.6))/28.,dot(q,vec3(-.48,.6,-.64))/28.,-dot(q,vec3(.36,.8,.48))/48.);
  gl_Position=pass==1 ? vec4(sun,1.) : vec4(right*lens.x,up*lens.y+lens.z*depth,1.00080032*depth-.20008003,depth);
  if(pass==3)gl_Position=vec4(right*lens.x/lens.w,up*lens.y/lens.w+lens.z,depth/100.,1.);
  col=color;parcel=int(lot);
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
in vec3 col;
in vec3 sun;
in float depth;
flat in int parcel;
uniform int pass;
uniform sampler2D shadowMap;
out vec4 outColor;
void main(){
  if(pass==1){outColor=vec4(1.);return;}
  if(pass==2){outColor=vec4(float(parcel%256)/255.,float(parcel/256)/255.,0.,1.);return;}
  vec3 c=col;
  if(pass==0){
    vec3 uv=sun*.5+.5;
    float shade=0.;
    if(all(lessThan(abs(sun),vec3(.999)))){
      for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
        float blocker=texture(shadowMap,uv.xy+vec2(x,y)/2048.).r;
        shade+=step(blocker+.00045,uv.z)/9.;
      }
    }
    c*=mix(vec3(1.),vec3(.66,.73,.78),shade);
    c=mix(c,vec3(.78,.87,.86),smoothstep(24.,140.,depth)*.8);
  }
  outColor=vec4(c,1.);
}`;
export class Renderer extends OrbitCamera {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  camera;
  lens;
  tiltUniform;
  pass;
  shadow;
  shadowMap;
  pickTarget;
  constructor(public canvas: HTMLCanvasElement) {
    super();
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw Error("Enable WebGL2 in your browser to open the town.");
    this.gl = gl;
    const p = gl.createProgram()!;
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const s = gl.createShader(kind)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s) ?? "Shader error");
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error("Renderer setup failed");
    gl.useProgram(p);
    this.program = p;
    this.camera = gl.getUniformLocation(p, "camera");
    this.lens = gl.getUniformLocation(p, "lens");
    this.tiltUniform = gl.getUniformLocation(p, "tilt");
    this.pass = gl.getUniformLocation(p, "pass");
    this.shadow = gl.createFramebuffer()!;
    this.shadowMap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 2048, 2048);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowMap, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    this.checkFramebuffer();
    this.pickTarget = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    for (const [format, attachment] of [
      [gl.RGBA8, gl.COLOR_ATTACHMENT0],
      [gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
    ]) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, format, 1, 1);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, rb);
    }
    this.checkFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enableVertexAttribArray(2);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
  }
  private checkFramebuffer() {
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE)
      throw Error("Unable to create 3D render target.");
  }
  upload(mesh: Mesh, previous?: WebGLBuffer) {
    const gl = this.gl;
    const buffer = previous ?? gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const vertices = new Float32Array((mesh.data.length / 6) * 7);
    let range = 0;
    for (let src = 0, dst = 0; src < mesh.data.length; src += 6, dst += 7) {
      while (range < mesh.lots.length && mesh.lots[range].end <= src) range++;
      const lot = mesh.lots[range];
      for (let j = 0; j < 6; j++) vertices[dst + j] = mesh.data[src + j];
      vertices[dst + 6] = lot && src >= lot.start ? lot.id + 1 : 0;
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertices, previous ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    return { buffer, count: mesh.data.length / 6 };
  }
  begin(w: number, h: number, scale: number, bg: number[], ratio = 1, thumbnail = false) {
    const gl = this.gl;
    this.distance = (h * focalLength) / (2 * scale);
    const width = Math.round(w * ratio),
      height = Math.round(h * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform4f(this.camera, this.x, this.z, Math.cos(this.angle), Math.sin(this.angle));
    gl.uniform4f(this.lens, (focalLength * h) / w, focalLength, this.offset, this.distance);
    gl.uniform2f(this.tiltUniform, Math.sin(this.pitch), Math.cos(this.pitch));
    gl.uniform1i(this.pass, thumbnail ? 3 : 0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap);
  }
  draw(m: { buffer: WebGLBuffer; count: number }) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }
  bakeShadows(scene: BufferMesh) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow);
    gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(this.pass, 1);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(3, 4);
    this.draw(scene);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  visibleLot(px: number, py: number, scene: BufferMesh) {
    const gl = this.gl,
      r = this.canvas.getBoundingClientRect();
    const w = this.canvas.width,
      h = this.canvas.height;
    const x = Math.floor(((px - r.left) * w) / r.width),
      y = h - 1 - Math.floor(((py - r.top) * h) / r.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    gl.viewport(-x, -y, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1i(this.pass, 2);
    gl.disable(gl.DITHER);
    this.draw(scene);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.enable(gl.DITHER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.uniform1i(this.pass, 0);
    return pixel[0] + 256 * pixel[1] - 1;
  }
  groundAt(px: number, py: number) {
    const r = this.canvas.getBoundingClientRect();
    return this.ground(
      (2 * (px - r.left)) / r.width - 1,
      1 - (2 * (py - r.top)) / r.height,
      r.width / r.height,
    );
  }
  pick(px: number, py: number) {
    const hit = this.groundAt(px, py);
    return hit ? { x: Math.floor(hit.x), z: Math.floor(hit.z) } : null;
  }
}
