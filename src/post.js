// Post-processing: HDR scene buffer with MSAA, bloom, speed blur, filmic tone mapping, grading and vignette.
const Post = (() => {
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const PREFILTER = `
    varying vec2 vUv; uniform sampler2D tex; uniform vec2 texel; uniform float threshold;
    void main(){
      vec3 c = vec3(0.0);
      c += texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2(-1.0,  1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0,  1.0)).rgb;
      c *= 0.25;
      c = min(c, vec3(24.0));
      float l = max(c.r, max(c.g, c.b));
      float k = smoothstep(threshold * 0.6, threshold * 1.4, l);
      gl_FragColor = vec4(c * k, 1.0);
    }`;
  const DOWN = `
    varying vec2 vUv; uniform sampler2D tex; uniform vec2 texel;
    void main(){
      vec3 c = texture2D(tex, vUv).rgb * 4.0;
      c += texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2(-1.0,  1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0,  1.0)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }`;
  const UP = `
    varying vec2 vUv; uniform sampler2D tex; uniform sampler2D base; uniform vec2 texel;
    void main(){
      vec3 c = vec3(0.0);
      c += texture2D(tex, vUv + texel * vec2(-1.0, 0.0)).rgb * 2.0;
      c += texture2D(tex, vUv + texel * vec2( 1.0, 0.0)).rgb * 2.0;
      c += texture2D(tex, vUv + texel * vec2(0.0, -1.0)).rgb * 2.0;
      c += texture2D(tex, vUv + texel * vec2(0.0,  1.0)).rgb * 2.0;
      c += texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0, -1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2(-1.0,  1.0)).rgb;
      c += texture2D(tex, vUv + texel * vec2( 1.0,  1.0)).rgb;
      gl_FragColor = vec4(c / 12.0 + texture2D(base, vUv).rgb, 1.0);
    }`;
  const FINAL = `
    varying vec2 vUv; uniform sampler2D tex; uniform sampler2D bloom;
    uniform float blur; uniform float strength; uniform float exposure; uniform float aspect;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 color){
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= exposure / 0.6;
      color = inM * color; color = RRTAndODTFit(color); color = outM * color;
      return clamp(color, 0.0, 1.0);
    }
    void main(){
      vec2 d = vUv - vec2(0.5, 0.56);
      float r2 = dot(d * vec2(aspect, 1.0), d * vec2(aspect, 1.0));
      vec3 c = texture2D(tex, vUv).rgb;
      if (blur > 0.001) {
        float amt = blur * 0.11 * smoothstep(0.03, 0.5, r2);
        vec3 acc = c; float w = 1.0;
        for (int i = 1; i <= 9; i++) {
          float t = float(i) / 9.0;
          acc += texture2D(tex, vUv - d * amt * t).rgb * (1.0 - t * 0.5); w += 1.0 - t * 0.5;
        }
        c = acc / w;
      }
      c += texture2D(bloom, vUv).rgb * strength;
      c = aces(c);
      // gentle grade: a touch of contrast and saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
      vec2 v = vUv - 0.5;
      c *= 1.0 - dot(v, v) * 0.55;
      c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      gl_FragColor = vec4(c, 1.0);
    }`;

  function create(renderer, lowPower) {
    const ok = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    const mats = {
      pre: mk(PREFILTER, { tex: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.35 } }),
      down: mk(DOWN, { tex: { value: null }, texel: { value: new THREE.Vector2() } }),
      up: mk(UP, { tex: { value: null }, base: { value: null }, texel: { value: new THREE.Vector2() } }),
      fin: mk(FINAL, { tex: { value: null }, bloom: { value: null }, blur: { value: 0 }, strength: { value: 0.22 }, exposure: { value: 0.95 }, aspect: { value: 1 } }),
    };
    const LEVELS = 5;
    let sceneRT = null, down = [], up = [];
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    let enabled = ok;

    function setSize(w, h) {
      if (!ok) return;
      const pr = renderer.getPixelRatio();
      const W = Math.max(2, Math.floor(w * pr)), H = Math.max(2, Math.floor(h * pr));
      if (sceneRT) { sceneRT.dispose(); down.forEach(t => t.dispose()); up.forEach(t => t.dispose()); }
      sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: lowPower ? 0 : 4 });
      down = []; up = [];
      let lw = W, lh = H;
      for (let i = 0; i < LEVELS; i++) {
        lw = Math.max(2, lw >> 1); lh = Math.max(2, lh >> 1);
        down.push(new THREE.WebGLRenderTarget(lw, lh, opts));
        up.push(new THREE.WebGLRenderTarget(lw, lh, opts));
      }
      mats.fin.uniforms.aspect.value = W / H;
    }

    function pass(mat, target) {
      quad.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(qs, cam);
    }

    function render(scene, camera, blur) {
      if (!enabled || !sceneRT) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      const shadowAuto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      mats.pre.uniforms.tex.value = sceneRT.texture;
      mats.pre.uniforms.texel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      pass(mats.pre, down[0]);
      for (let i = 1; i < LEVELS; i++) {
        mats.down.uniforms.tex.value = down[i - 1].texture;
        mats.down.uniforms.texel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
        pass(mats.down, down[i]);
      }
      let src = down[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) {
        mats.up.uniforms.tex.value = src.texture;
        mats.up.uniforms.base.value = down[i].texture;
        mats.up.uniforms.texel.value.set(1 / src.width, 1 / src.height);
        pass(mats.up, up[i]);
        src = up[i];
      }
      mats.fin.uniforms.tex.value = sceneRT.texture;
      mats.fin.uniforms.bloom.value = src.texture;
      mats.fin.uniforms.blur.value = blur;
      pass(mats.fin, null);
      renderer.shadowMap.autoUpdate = shadowAuto;
    }

    return { render, setSize, supported: ok, toggle() { enabled = ok && !enabled; return enabled; } };
  }

  return { create };
})();
