import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// Runs after OutputPass, so it works in display space where grain and vignette behave the way
// they look in a photograph rather than being stretched by tone mapping.
const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.028 },
    uVignette: { value: 0.55 },
    uResolution: { value: null }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Darkens the corners so the eye settles in the middle, where the writing is.
      float r = length(vUv - 0.5) * 1.41421;
      color.rgb *= mix(1.0, smoothstep(1.05, 0.30, r), uVignette);

      // Animated grain stops large dark areas from banding into flat plates.
      float n = hash(vUv * uResolution + fract(uTime * 0.7) * 137.0);
      color.rgb += (n - 0.5) * uGrain;

      gl_FragColor = color;
    }
  `
};

/**
 * RenderPass -> bloom -> tone mapping + sRGB -> grain/vignette.
 *
 * Bloom is what turns painted sprite glow into light that spills, and it is the single
 * biggest visual difference between the old scene and this one.
 */
export function createComposer({ THREE, renderer, scene, camera, quality }) {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(quality.pixelRatio);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x * quality.bloom.scale, size.y * quality.bloom.scale),
    quality.bloom.strength,
    quality.bloom.radius,
    quality.bloom.threshold
  );
  composer.addPass(bloom);

  // Reads renderer.toneMapping, then converts to the output colour space.
  composer.addPass(new OutputPass());

  const grain = new ShaderPass(GrainVignetteShader);
  grain.uniforms.uGrain.value = quality.grain;
  grain.uniforms.uVignette.value = quality.vignette;
  grain.uniforms.uResolution.value = new THREE.Vector2(size.x, size.y);
  composer.addPass(grain);

  return {
    composer,
    bloom,
    grain,
    setSize(width, height) {
      composer.setSize(width, height);
      bloom.setSize(width * quality.bloom.scale, height * quality.bloom.scale);
      grain.uniforms.uResolution.value.set(width, height);
    },
    update(elapsedSeconds) {
      grain.uniforms.uTime.value = elapsedSeconds;
    }
  };
}
