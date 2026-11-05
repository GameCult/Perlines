// Small WebGL2 helpers: programs, a fullscreen triangle, a feedback (persistence) target, mat4.

export function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), name = a.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export const GLSL_HEAD = '#version 300 es\nprecision highp float;\n';

// Hash-based gradient-free value noise + fbm, enough for shader-side flow; the CPU paths use real Perlin.
export const GLSL_NOISE = `
float hash31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

export function fullscreen(gl) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/**
 * Persistence: scenes draw into one of two textures; each frame the previous texture is copied
 * forward multiplied by a decay (trails), the scene adds on top, and the result is blitted to screen.
 */
export class Feedback {
  constructor(gl) {
    this.gl = gl; this.w = 0; this.h = 0; this.i = 0; this.tex = []; this.fbo = [];
    this.tri = fullscreen(gl);
    this.copy = program(gl, GLSL_HEAD + 'layout(location=0) in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0,1); }',
      GLSL_HEAD + 'uniform sampler2D t; uniform float decay; uniform vec2 px; in vec2 uv; out vec4 o; void main(){ vec3 c = texture(t, uv).rgb; vec3 g = texture(t, uv + px).rgb * 0.5 + texture(t, uv - px).rgb * 0.5; o = vec4(mix(c, g, 0.35) * decay, 1.0); }');
    this.blit = program(gl, GLSL_HEAD + 'layout(location=0) in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0,1); }',
      GLSL_HEAD + 'uniform sampler2D t; in vec2 uv; out vec4 o; void main(){ vec3 c = texture(t, uv).rgb; c = 1.0 - exp(-c * 1.4); o = vec4(pow(c, vec3(0.9)), 1.0); }');
  }
  resize(w, h) {
    const gl = this.gl;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (let k = 0; k < 2; k++) {
      if (this.tex[k]) { gl.deleteTexture(this.tex[k]); gl.deleteFramebuffer(this.fbo[k]); }
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      this.tex[k] = t; this.fbo[k] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Fade the previous frame into the next target and bind it; the scene then draws additively. */
  begin(decay) {
    const gl = this.gl, prev = this.i, next = 1 - this.i;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next]);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.copy.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[prev]);
    gl.uniform1i(this.copy.u.t, 0); gl.uniform1f(this.copy.u.decay, decay); gl.uniform2f(this.copy.u.px, 0.6 / this.w, 0.6 / this.h);
    gl.bindVertexArray(this.tri); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.i = next;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  }
  present() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.blit.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[this.i]);
    gl.uniform1i(this.blit.u.t, 0);
    gl.bindVertexArray(this.tri); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  clear() {
    const gl = this.gl;
    for (const f of this.fbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

// column-major mat4
export const mat4 = {
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
    return m;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
};
