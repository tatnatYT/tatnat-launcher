// "Live eclipse": an animated WebGL wallpaper for the background picker (backgrounds.js): drifting
// nebula clouds, twinkling stars and a slowly turning eclipse corona. Drawn at half resolution and
// 30 frames a second, paused while the window is hidden, one still frame with effects Off.
window.makeLiveEclipse = function makeLiveEclipse() {
  const el = document.createElement('div');
  el.className = 'bg-layer bg-live';
  const cv = document.createElement('canvas');
  el.append(cv);
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) { el.classList.add('bg-live-fallback'); return el; }

  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `precision highp float;uniform vec2 res;uniform float t;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
    void main(){
      vec2 uv=gl_FragCoord.xy/res;
      vec2 p=(gl_FragCoord.xy-.5*res)/res.y;
      vec3 col=mix(vec3(.018,.014,.04),vec3(.055,.03,.1),uv.y);
      // nebula
      vec2 q=p*1.5+vec2(t*.012,-t*.004);
      float n1=fbm(q+1.4*fbm(q*1.2+vec2(t*.02,0.)));
      float n2=fbm(q*2.3-vec2(t*.016,t*.01));
      col+=vec3(.5,.2,.85)*pow(n1,2.2)*1.35+vec3(.14,.26,.7)*pow(n2,2.8)*1.;
      // stars
      vec2 g=gl_FragCoord.xy/(res.y/180.);vec2 id=floor(g);vec2 f=fract(g)-.5;
      float s=h(id);
      if(s>.982){vec2 o=vec2(h(id+1.3),h(id+2.7))-.5;float d=length(f-o*.6);
        float tw=.55+.45*sin(t*(.8+s*3.)+s*60.);col+=vec3(.92,.88,1.)*smoothstep(.09,0.,d)*tw;}
      // eclipse
      vec2 c=vec2(res.x/res.y*.5-.36,.355);vec2 e=p-c;float r=length(e),a=atan(e.y,e.x);
      float R=.052;
      float rays=fbm(vec2(a*3.+t*.04,r*6.-t*.22))*.9+fbm(vec2(a*9.-t*.03,t*.15))*.45;
      float fall=exp(-max(r-R,0.)*13.);
      col+=vec3(.56,.42,1.)*fall*(.18+rays)*(1.05+.12*sin(t*.7))+vec3(.92,.88,1.)*pow(fall,7.);
      col=mix(col,vec3(.018,.013,.032),smoothstep(R+.003,R-.002,r));
      col*=1.-.4*length(uv-vec2(.5,.45));
      gl_FragColor=vec4(col,1.);
    }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { el.classList.add('bg-live-fallback'); return el; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'res'), uT = gl.getUniformLocation(prog, 't');

  const t0 = performance.now() - 20000 * Math.random();
  let last = 0, drawn = false;
  function frame(now) {
    if (!el.isConnected && drawn) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
    requestAnimationFrame(frame);
    const still = document.documentElement.dataset.bgfx === 'off';
    if (document.hidden || now - last < 33 || (still && drawn)) return;
    last = now;
    const w = Math.max(2, Math.round(cv.clientWidth * .5)), hh = Math.max(2, Math.round(cv.clientHeight * .5));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; drawn = false; }
    gl.viewport(0, 0, w, hh);
    gl.uniform2f(uRes, w, hh);
    gl.uniform1f(uT, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawn = el.isConnected;
  }
  requestAnimationFrame(frame);
  return el;
};
