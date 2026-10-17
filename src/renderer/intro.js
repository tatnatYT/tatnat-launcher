// The startup eclipse, run straight after cool.js builds the splash so the old logo never shows first.
(() => {
  // Startup: a WebGL eclipse. The moon slides over a bright sun, the corona flares out and a
  // "diamond ring" flashes, then the logo text shows. Falls back to the logo picture without WebGL.
  (function eclipseIntro() {
    const logo = document.querySelector('#splash .splash-logo');
    if (!logo) return;
    const plain = () => document.getElementById('splash')?.classList.add('plain');
    let off = false;
    try { off = localStorage.getItem('bg-effects') === 'off'; } catch { /* storage off */ }
    if (off) { plain(); return; }
    const cv = document.createElement('canvas');
    cv.className = 'splash-eclipse';
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) { plain(); return; }
    const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const FS = `precision highp float;uniform vec2 res;uniform float t;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
      void main(){
        vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
        float R=.17;
        float k=clamp(t/1.25,0.,1.);k=1.-pow(1.-k,3.);
        vec2 mc=mix(vec2(-.3,.12),vec2(0.),k);
        float r=length(uv),a=atan(uv.y,uv.x);
        float rays=fbm(vec2(a*2.5+sin(a)*.5,r*5.-t*.7))*.9+fbm(vec2(a*8.,t*.35))*.45;
        float fall=exp(-max(r-R,0.)*mix(16.,6.5,k));
        float corona=fall*(.25+rays)*mix(.25,1.5,k);
        vec3 col=vec3(.58,.44,1.)*corona+vec3(.85,.8,1.)*pow(fall,5.)*mix(.15,1.1,k);
        col=mix(col,vec3(1.,.97,1.),smoothstep(R+.004,R-.004,r));
        float moon=smoothstep(R+.007,R-.001,length(uv-mc));
        col=mix(col,vec3(.035,.025,.06),moon);
        float fl=exp(-((t-1.2)*6.)*((t-1.2)*6.));
        vec2 dp=vec2(-R*.62,R*.79);float d=length(uv-dp);
        col+=vec3(1.,.95,1.)*fl*(.025/(d+.012))*(1.-moon*.92);
        col+=vec3(.85,.75,1.)*fl*.0012/(abs(uv.y-dp.y)+.003)*exp(-abs(uv.x-dp.x)*9.)*(1.-moon);
        col*=smoothstep(0.,.25,t)*smoothstep(.5,.3,r);
        // the moon is a solid dark disc, not see-through
        float al=max(clamp(max(max(col.r,col.g),col.b),0.,1.),moon*smoothstep(0.,.25,t)*smoothstep(.5,.36,length(uv-mc)+R));
        gl_FragColor=vec4(min(col,vec3(1.)),al);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { plain(); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'res'), uT = gl.getUniformLocation(prog, 't');
    const size = 300, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = size * dpr;
    logo.replaceWith(cv);
    const t0 = performance.now();
    const draw = now => {
      if (!cv.isConnected) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    document.getElementById('splash')?.classList.add('has-eclipse');
  })();

})();
