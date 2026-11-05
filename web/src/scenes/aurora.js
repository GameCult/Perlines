// Aurora disk: the spectrum history extruded into a polar mesh.
// Angle = frequency (mirrored, bass at the seam), radius = age (centre newest), height = band level.
import { program, GLSL_HEAD, GLSL_NOISE, mat4 } from '../gl.js';

const RINGS = 112, SEGS = 224;

const VS = GLSL_HEAD + GLSL_NOISE + `
layout(location=0) in vec2 pr;           // x = ring 0..1, y = segment 0..1
uniform sampler2D hist; uniform float newest, time, kick, spin; uniform mat4 mvp;
out float h; out float ring; out float seg;
void main(){
  float ang = pr.y * 6.2831853;
  float f = abs(pr.y * 2.0 - 1.0);                       // mirrored frequency coordinate
  float age = pr.x * 0.92;
  float row = fract(newest - age);
  float v = texture(hist, vec2(f, row)).r;
  float n = vnoise(vec3(cos(ang) * 1.6, sin(ang) * 1.6, pr.x * 3.0 - time * 0.35));
  h = v * (0.55 + 0.9 * n) * (1.0 - 0.6 * pr.x);
  float rad = 0.12 + pr.x * 1.45 * (1.0 + 0.05 * kick);
  ang += spin;
  vec3 p = vec3(cos(ang) * rad, h * 0.9 + 0.1 * sin(pr.x * 18.0 - time * 2.0) * v, sin(ang) * rad);
  ring = pr.x; seg = pr.y;
  gl_Position = mvp * vec4(p, 1.0);
}`;

const FS = GLSL_HEAD + `
in float h; in float ring; in float seg;
uniform vec3 tint; uniform float kick; uniform float time;
out vec4 o;
void main(){
  // curtain gradient: tint at the base, shifting toward cyan/green-white at the crest, like auroral oxygen/nitrogen lines
  vec3 base = tint;
  vec3 crest = mix(tint.gbr, vec3(0.8, 1.0, 0.9), 0.55);
  vec3 c = mix(base, crest, smoothstep(0.1, 0.9, h));
  float lines = 0.55 + 0.45 * smoothstep(0.82, 1.0, abs(sin(seg * 256.0 * 3.14159)));
  float fade = (1.0 - ring) * (1.0 - ring) * 0.9 + 0.05;
  float a = (0.02 + h * h * 0.75) * lines * fade * (1.0 + 1.5 * kick);
  o = vec4(c * a, 1.0);
}`;

export class AuroraDisk {
  constructor(gl) {
    this.name = 'Aurora disk'; this.persistence = 0.82;
    this.prog = program(gl, VS, FS);
    const pr = new Float32Array(RINGS * (SEGS + 1) * 2);
    let k = 0;
    for (let r = 0; r < RINGS; r++) for (let s = 0; s <= SEGS; s++) { pr[k++] = r / (RINGS - 1); pr[k++] = s / SEGS; }
    const idx = new Uint32Array((RINGS - 1) * SEGS * 6); k = 0;
    for (let r = 0; r < RINGS - 1; r++) for (let s = 0; s < SEGS; s++) {
      const a = r * (SEGS + 1) + s, b = a + SEGS + 1;
      idx.set([a, b, a + 1, a + 1, b, b + 1], k); k += 6;
    }
    this.count = idx.length;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, pr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.kick = 0; this.spin = 0; this.seen = 0;
  }
  draw(gl, A, w, h, hist) {
    if (A.onset.count !== this.seen) { this.seen = A.onset.count; this.kick = Math.max(this.kick, 0.4 + 0.6 * A.onset.strength); }
    this.kick *= Math.pow(0.0008, A.dt);
    this.spin += A.dt * (0.05 + 0.4 * this.kick + 0.2 * A.bass);
    const proj = mat4.perspective(0.9, w / h, 0.1, 20);
    const view = mat4.mul(mat4.translate(0, -0.15, -2.6), mat4.mul(mat4.rotX(0.62 + 0.04 * Math.sin(A.time * 0.2)), mat4.rotY(0)));
    const P = this.prog;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.mvp, false, mat4.mul(proj, view));
    gl.uniform1f(P.u.newest, hist.newest); gl.uniform1f(P.u.time, A.time); gl.uniform1f(P.u.kick, this.kick); gl.uniform1f(P.u.spin, this.spin);
    gl.uniform3fv(P.u.tint, A.tint);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, hist.tex); gl.uniform1i(P.u.hist, 1);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }
}
