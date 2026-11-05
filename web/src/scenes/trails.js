// Vector trails: heads ride a divergence-free Perlin curl field, one head per spectrum lane;
// onsets kick speed and respawn a spray of heads from the centre. Each head leaves a polyline trail.
import { program, GLSL_HEAD } from '../gl.js';
import { makeNoise } from '../noise.js';
import { NB } from '../analysis.js';

const HEADS = 96, LEN = 72;

const VS = GLSL_HEAD + `
layout(location=0) in vec2 a;    // trail point; slot 0 is the head
uniform float aspect; out float al; out float lane;
void main(){
  al = 1.0 - float(gl_VertexID % ${LEN}) / ${LEN - 1}.0;
  lane = float(gl_VertexID / ${LEN}) / ${HEADS}.0;
  gl_Position = vec4(a.x / aspect, a.y, 0.0, 1.0);
}`;
const FS = GLSL_HEAD + `
in float al; in float lane; uniform vec3 tint; uniform float level; out vec4 o;
void main(){
  vec3 c = mix(tint, tint.brg * 0.8 + 0.2, lane);
  c = mix(c, vec3(1.0), pow(al, 6.0) * 0.6);
  o = vec4(c * pow(al, 1.6) * (0.35 + level), 1.0);
}`;

export class VectorTrails {
  constructor(gl) {
    this.name = 'Vector trails'; this.persistence = 0.9;
    this.prog = program(gl, VS, FS);
    this.noise = makeNoise(2013);
    this.pos = new Float32Array(HEADS * 2);       // head positions
    this.vel = new Float32Array(HEADS * 2);
    this.trail = new Float32Array(HEADS * LEN * 2);  // x, y per point
    this.energy = new Float32Array(HEADS);
    this.life = new Float32Array(HEADS);
    this.scratch = new Float32Array(2);
    for (let i = 0; i < HEADS; i++) this.respawn(i, 0.2 + Math.random() * 1.0);
    const idx = new Uint16Array(HEADS * (LEN - 1) * 2); let k = 0;
    for (let h = 0; h < HEADS; h++) for (let s = 0; s < LEN - 1; s++) { idx[k++] = h * LEN + s; idx[k++] = h * LEN + s + 1; }
    this.count = idx.length;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.trail, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.seen = 0; this.kick = 0;
  }
  respawn(i, radius) {
    const a = Math.random() * Math.PI * 2;
    this.pos[i * 2] = Math.cos(a) * radius * 0.2; this.pos[i * 2 + 1] = Math.sin(a) * radius * 0.2;
    this.vel[i * 2] = Math.cos(a) * radius; this.vel[i * 2 + 1] = Math.sin(a) * radius;
    this.life[i] = 4 + Math.random() * 6;
    const base = i * LEN * 2;
    for (let s = 0; s < LEN; s++) { this.trail[base + s * 2] = this.pos[i * 2]; this.trail[base + s * 2 + 1] = this.pos[i * 2 + 1]; }
  }
  draw(gl, A, w, h) {
    const dt = A.dt, t = A.time, n = this.noise, c = this.scratch;
    if (A.onset.count !== this.seen) {
      this.seen = A.onset.count; this.kick = Math.min(1.5, this.kick + 0.5 + A.onset.strength);
      const spray = Math.round(8 + 24 * A.onset.strength);
      for (let j = 0; j < spray; j++) this.respawn((Math.random() * HEADS) | 0, 1.2 + 2.2 * A.onset.strength);
    }
    this.kick *= Math.pow(0.02, dt);
    for (let i = 0; i < HEADS; i++) {
      const band = Math.min(NB - 1, Math.floor(Math.pow(i / HEADS, 1.3) * NB * 0.85));
      const e = A.bands[band]; this.energy[i] += (e - this.energy[i]) * 0.3;
      const x = this.pos[i * 2], y = this.pos[i * 2 + 1];
      n.curl2(x * 0.9 + i * 0.13, y * 0.9, t * 0.18, c);
      const speed = 0.25 + 1.2 * this.energy[i] + 1.4 * this.kick;
      // steer velocity toward the flow; spray velocity decays toward it, so heads start as a burst and then drift
      const k = 1 - Math.pow(0.15, dt);
      this.vel[i * 2] += (c[0] * speed * 0.55 - this.vel[i * 2]) * k;
      this.vel[i * 2 + 1] += (c[1] * speed * 0.55 - this.vel[i * 2 + 1]) * k;
      let nx = x + this.vel[i * 2] * dt, ny = y + this.vel[i * 2 + 1] * dt;
      this.life[i] -= dt;
      if (this.life[i] <= 0 || Math.abs(nx) > 3 || Math.abs(ny) > 1.6) { this.respawn(i, 0.3 + this.energy[i]); continue; }
      this.pos[i * 2] = nx; this.pos[i * 2 + 1] = ny;
      const base = i * LEN * 2;
      this.trail.copyWithin(base + 2, base, base + (LEN - 1) * 2);
      this.trail[base] = nx; this.trail[base + 1] = ny;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trail);
    const P = this.prog;
    gl.useProgram(P.p);
    gl.uniform1f(P.u.aspect, w / h); gl.uniform3fv(P.u.tint, A.tint); gl.uniform1f(P.u.level, A.level * 0.8 + this.kick * 0.3);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.LINES, this.count, gl.UNSIGNED_SHORT, 0);
  }
}
