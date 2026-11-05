// Burning water: a flame-lit ripple plane, with an onset-driven spray of embers lofted off the surface.
// Particles are stateless: the CPU only writes (birth, seed, strength, lane) into a ring buffer on onsets;
// the vertex shader computes every position from age, so the per-frame cost is one point draw.
import { program, fullscreen, GLSL_HEAD, GLSL_NOISE } from '../gl.js';

const MAX = 6144;

const SURF_FS = GLSL_HEAD + GLSL_NOISE + `
in vec2 uv; uniform vec2 res; uniform float time, bass, level; uniform vec3 tint;
uniform vec4 ripples[8];     // x, y (surface coords), birth time, strength
out vec4 o;
void main(){
  vec2 p = (uv * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  // horizon at y = 0.1, plane below it
  float d = p.y - 0.1;
  if (d > -0.01) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float depth = 0.55 / -d;                          // distance along the plane
  vec2 s = vec2(p.x * depth, depth);                // surface coords
  float hgt = fbm(vec3(s * 0.9, time * 0.25)) * 0.7;
  vec2 g = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float age = time - ripples[i].z;
    if (age < 0.0 || age > 3.0) continue;
    float r = length(s - ripples[i].xy);
    float front = age * 2.4;
    float w = exp(-pow((r - front) * 2.2, 2.0)) * exp(-age * 1.1) * ripples[i].w;
    hgt += w * sin((r - front) * 9.0) * 0.6;
  }
  float e = 0.04;
  float hx = fbm(vec3((s + vec2(e, 0)) * 0.9, time * 0.25)) * 0.7;
  float hy = fbm(vec3((s + vec2(0, e)) * 0.9, time * 0.25)) * 0.7;
  vec3 n = normalize(vec3((hgt - hx) / e * 0.5, 1.0, (hgt - hy) / e * 0.5));
  float flame = pow(max(0.0, n.x * 0.6 + n.z * 0.8 + 0.3) , 2.0) + hgt * 0.8;
  vec3 hot = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.9, 0.5), smoothstep(0.5, 1.4, flame + level));
  vec3 cold = tint * 0.6;
  vec3 c = mix(cold, hot, smoothstep(0.2, 0.9, flame + bass)) * (0.25 + 0.75 * exp(-depth * 0.12));
  c *= mix(0.35, 1.0, tint.b + 0.2) ;
  o = vec4(c * (0.15 + 0.5 * level + 0.35 * bass) * 0.22, 1.0);
}`;

const PVS = GLSL_HEAD + `
layout(location=0) in vec4 a;     // birth, seed, strength, lane
uniform float time; uniform vec2 res;
out float life; out float heat;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  float age = time - a.x;
  if (a.x < 0.0 || age < 0.0 || age > 2.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float s = a.y, str = a.z;
  float vx = (h1(s) - 0.5) * 1.4 * (0.5 + str) + (a.w - 0.5) * 0.7;
  float vy = (1.2 + 2.6 * h1(s + 3.0) * str + 0.8 * str);
  float x = (a.w * 2.0 - 1.0) * 0.95 + vx * age + 0.08 * sin(age * 7.0 + s * 40.0);
  float y = -0.1 + vy * age - 1.9 * age * age;
  if (y < -0.1 && age > 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  life = 1.0 - age / 2.6; heat = life * (0.4 + str);
  gl_Position = vec4(x / (res.x / res.y), y, 0.0, 1.0);
  gl_PointSize = (2.0 + 9.0 * h1(s + 7.0) * str) * (0.4 + life) * res.y / 900.0;
}`;
const PFS = GLSL_HEAD + `
in float life; in float heat; uniform vec3 tint; out vec4 o;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
  vec3 fire = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.85, 0.4), heat);
  fire = mix(fire, tint * 1.3, 0.25 * (1.0 - heat));
  o = vec4(fire * (1.0 - r) * life * 0.9, 1.0);
}`;

export class BurningWater {
  constructor(gl) {
    this.name = 'Burning water'; this.persistence = 0.78;
    this.surf = program(gl, GLSL_HEAD + 'layout(location=0) in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0,1); }', SURF_FS);
    this.part = program(gl, PVS, PFS);
    this.tri = fullscreen(gl);
    this.data = new Float32Array(MAX * 4).fill(-1);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.head = 0; this.seen = 0; this.ripples = new Float32Array(32).fill(0); this.rhead = 0; this.dirty = [0, 0];
    for (let i = 0; i < 8; i++) this.ripples[i * 4 + 2] = -10;
    this.seed = 1; this.acc = 0;
  }
  spawn(n, t, strength) {
    const d = this.data;
    const first = this.head;
    for (let i = 0; i < n; i++) {
      const j = this.head; this.head = (this.head + 1) % MAX;
      this.seed += 1.618;
      d[j * 4] = t; d[j * 4 + 1] = this.seed; d[j * 4 + 2] = strength * (0.5 + 0.5 * Math.random()); d[j * 4 + 3] = Math.random();
    }
    return first;
  }
  draw(gl, A, w, h) {
    const t = A.time;
    if (A.onset.count !== this.seen) {
      this.seen = A.onset.count;
      const s = A.onset.strength;
      this.spawn(Math.round(80 + 520 * s), t, 0.35 + 0.65 * s);
      const r = this.rhead; this.rhead = (this.rhead + 1) % 8;
      this.ripples.set([(Math.random() - 0.5) * 6, 1.5 + Math.random() * 4, t, 0.5 + s], r * 4);
    }
    // a thin continuous simmer follows the bass so quiet passages are not dead
    this.acc += A.dt * A.bass * 90;
    if (this.acc >= 1) { this.spawn(Math.floor(this.acc), t, 0.15 + 0.3 * A.level); this.acc %= 1; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);   // 96 KB; simplest correct upload, measured in the frame-time HUD

    let P = this.surf;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.res, w, h); gl.uniform1f(P.u.time, t); gl.uniform1f(P.u.bass, A.bass); gl.uniform1f(P.u.level, A.level);
    gl.uniform3fv(P.u.tint, A.tint); gl.uniform4fv(P.u.ripples, this.ripples);
    gl.bindVertexArray(this.tri); gl.drawArrays(gl.TRIANGLES, 0, 3);

    P = this.part;
    gl.useProgram(P.p);
    gl.uniform1f(P.u.time, t); gl.uniform2f(P.u.res, w, h); gl.uniform3fv(P.u.tint, A.tint);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.POINTS, 0, MAX);
  }
}
