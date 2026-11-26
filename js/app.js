/**
 * ========================================================================
   TABAHI — Next Level 3D Animation Engine (Three.js r166)
   Professional techniques researched from:
   - EffectComposer: UnrealBloomPass, BokehPass (DOF), FilmPass, Vignette, FXAA
   - Blender Python bpy keyframe workflow for offline rendering
   - Web Audio API PannerNode + AudioListener for spatial audio
   - GSAP-style easing for camera transitions
   ======================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { audio } from './audio.js';

/* ========================================================================
   CONFIG
   ======================================================================== */
const CONFIG = {
  DURATION: 30,           // seconds, loopable
  FPS: 60,
  FOV: 45,
  NEAR: 0.1,
  FAR: 250,
  BLOOM: { strength: 1.8, radius: 0.7, threshold: 0.1 },
  COLORS: {
    noir: 0x020205,
    noirSoft: 0x0d0a17,
    cyan: 0x00f3ff,
    violet: 0x7b2cff,
    orange: 0xff6b35,
    white: 0xffffff,
    concrete: 0x14141d,
    glass: 0x222233,
    gold: 0xffd36a,
  },
};

/* ========================================================================
   SHADERS — custom passes
   ======================================================================== */

// Chromatic aberration + vignette + color grade (impact spikes)
const VignetteGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    opacity: { value: 1.0 },
    offset: { value: 0.84 },
    darkness: { value: 1.8 },
    vignetteColor: { value: new THREE.Color(0x020205) },
    gradeR: { value: 1.05 },
    gradeG: { value: 0.96 },
    gradeB: { value: 1.12 },
    time: { value: 0 },
    chromaticAberration: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float opacity, offset, darkness;
    uniform vec3 vignetteColor;
    uniform float gradeR, gradeG, gradeB, time, chromaticAberration;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float ab = chromaticAberration * opacity;
      vec2 offR = (uv - 0.5) * ab;
      vec2 offG = (uv - 0.5) * (ab * 0.5);
      vec2 offB = (uv - 0.5) * (ab * 0.25);
      vec3 color = vec3(
        texture2D(tDiffuse, uv + offR).r,
        texture2D(tDiffuse, uv + offG).g,
        texture2D(tDiffuse, uv + offB).b
      );
      color.r *= gradeR; color.g *= gradeG; color.b *= gradeB;
      float d = distance(uv, vec2(0.5));
      float vig = smoothstep(offset, offset - 0.5, d);
      color = mix(color, vignetteColor, vig * darkness * opacity);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Film grain + subtle noise
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, opacity: { value: 0.05 }, seed: { value: 0 } },
  vertexShader: ` varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); } `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float opacity; uniform float seed; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453 + seed); }
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      float n = (rand(vUv * 400.0) - 0.5) * 2.0;
      gl_FragColor = vec4(tex.rgb + n * opacity, tex.a);
    }
  `,
};

/* ========================================================================
   UTILS
   ======================================================================== */
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpVec3(a, b, t, out) {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}
function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/* ========================================================================
   CAMERA RIG — manual interpolation for full story control
   ======================================================================== */
class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.shake = { intensity: 0, duration: 0, startTime: 0 };
    this.shakeOffset = new THREE.Vector3();
  }

  setPose(position, target, fov, roll) {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    if (fov !== undefined) this.camera.fov = fov;
    if (roll !== undefined) this.camera.rotation.z = roll;
    this.camera.updateProjectionMatrix();
  }

  interpolate(fromPos, fromTar, fromFov, fromRoll, toPos, toTar, toFov, toRoll, t) {
    const e = easeInOutCubic(t);
    const curPos = lerpVec3(fromPos, toPos, e, new THREE.Vector3());
    const curTar = lerpVec3(fromTar, toTar, e, new THREE.Vector3());
    this.camera.position.copy(curPos);
    this.camera.lookAt(curTar);
    if (toFov !== undefined) this.camera.fov = lerp(fromFov || 45, toFov, t);
    if (toRoll !== undefined) this.camera.rotation.z = lerp(fromRoll || 0, toRoll, t);
    this.camera.updateProjectionMatrix();
  }

  triggerShake(intensity = 0.08, duration = 0.4) {
    this.shake.intensity = intensity;
    this.shake.duration = duration;
    this.shake.startTime = performance.now();
  }

  updateShake(now) {
    if (this.shake.intensity <= 0.002) return;
    const elapsed = (now - this.shake.startTime) / 1000;
    if (elapsed > this.shake.duration) {
      this.shake.intensity *= 0.8;
      if (this.shake.intensity < 0.003) this.shake.intensity = 0;
    }
    const i = this.shake.intensity;
    this.shakeOffset.set(
      (Math.random() - 0.5) * i,
      (Math.random() - 0.5) * i,
      0
    );
    this.camera.position.add(this.shakeOffset);
  }
}

/* ========================================================================
   ENVIRONMENT — buildings, roads, lamps, debris, particles
   ======================================================================== */
class Environment {
  constructor(scene) {
    this.scene = scene;
    this.buildings = [];
    this.lamps = [];
    this.debris = [];
    this.particles = [];
    this.ground = null;
    this.build();
  }

  build() {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(240, 240, 64, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: CONFIG.COLORS.noirSoft,
      roughness: 0.5,
      metalness: 0.3,
      emissive: CONFIG.COLORS.noir,
      emissiveIntensity: 0.4,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Road
    const roadGeo = new THREE.PlaneGeometry(220, 220, 2, 2);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x08070f,
      emissive: 0x0f0a1a,
      emissiveIntensity: 1.2,
      roughness: 0.35,
      metalness: 0.5,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    this.scene.add(road);

    // Glowing lane lines
    const lineGeo = new THREE.BoxGeometry(210, 0.05, 0.4);
    const lineMat = new THREE.MeshStandardMaterial({
      color: CONFIG.COLORS.cyan,
      emissive: CONFIG.COLORS.cyan,
      emissiveIntensity: 5,
      roughness: 0.1,
    });
    for (let i = -3; i <= 3; i++) {
      const h = new THREE.Mesh(lineGeo, lineMat);
      h.position.set(i * 22, 0.03, 0);
      h.rotation.z = Math.PI / 2;
      this.scene.add(h);
    }
    for (let i = -3; i <= 3; i++) {
      const v = new THREE.Mesh(lineGeo, lineMat);
      v.position.set(0, 0.03, i * 22);
      this.scene.add(v);
    }

    // Buildings grid
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    const bMat = new THREE.MeshStandardMaterial({
      color: CONFIG.COLORS.concrete,
      roughness: 0.65,
      metalness: 0.2,
      emissive: 0x050508,
      emissiveIntensity: 0.5,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: CONFIG.COLORS.glass,
      emissive: CONFIG.COLORS.cyan,
      emissiveIntensity: 0.9,
      roughness: 0.05,
      metalness: 0.95,
      transparent: true,
      opacity: 0.9,
    });

    const grid = 11;
    const spacing = 18;

    for (let gx = 0; gx < grid; gx++) {
      for (let gz = 0; gz < grid; gz++) {
        const cx = (gx - grid / 2) * spacing + spacing / 2;
        const cz = (gz - grid / 2) * spacing + spacing / 2;
        const height = rnd(10, 36);
        const w = rnd(7, 13);
        const d = rnd(7, 13);

        const building = new THREE.Mesh(bGeo, bMat);
        building.scale.set(w, height, d);
        building.position.set(cx, height / 2, cz);
        building.castShadow = true;
        building.receiveShadow = true;
        building.userData = {
          origHeight: height,
          origPos: building.position.clone(),
          cx, cz,
          fold: 0,
          windowPulseOffset: Math.random() * 10,
        };
        this.scene.add(building);
        this.buildings.push(building);

        // Window strips
        const winCount = Math.floor(height / 3);
        for (let wj = 0; wj < winCount; wj++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 1.8), glassMat);
          win.position.set(0, 1.5 + wj * 3, d / 2 + 0.01);
          win.userData = { baseEmissive: glassMat.emissive.clone(), fold: 0 };
          building.add(win);
        }

        // Neon accent top
        if (Math.random() > 0.65) {
          const accentColor = Math.random() > 0.5 ? CONFIG.COLORS.violet : CONFIG.COLORS.orange;
          const accent = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.95, 1.4, d * 0.95),
            new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 2.5 })
          );
          accent.position.set(0, height + 0.7, 0);
          building.add(accent);
          building.userData.accent = accent;
        }
      }
    }

    // Street lamps
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const radius = 88;
      const lx = Math.cos(angle) * radius;
      const lz = Math.sin(angle) * radius;
      const group = new THREE.Group();

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
      pole.position.y = 4;
      pole.castShadow = true;

      const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.cyan, emissive: CONFIG.COLORS.cyan, emissiveIntensity: 1.8 }));
      head.position.y = 8;
      head.rotation.x = Math.PI / 2;

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: CONFIG.COLORS.cyan, emissiveIntensity: 6 }));
      bulb.position.y = 8;

      const light = new THREE.PointLight(CONFIG.COLORS.cyan, 40, 26);
      light.position.set(0, 8, 0);
      light.castShadow = true;

      group.add(light, pole, head, bulb);
      group.position.set(lx, 0, lz);
      group.lookAt(lx * 0.55, 0, lz * 0.55);
      group.userData = { bulb, head, light, flickerOffset: Math.random() * 100 };
      this.scene.add(group);
      this.lamps.push(group);
    }

    // Debris pool
    this.debrisGeo = new THREE.BoxGeometry(0.4, rnd(0.8, 1.8), 0.4);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.85 });
  }

  spawnDebris(count = 210, center = new THREE.Vector3(0, 10, 0)) {
    for (let i = 0; i < count; i++) {
      const shard = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      shard.position.copy(center);
      shard.position.x += rnd(-6, 6);
      shard.position.y += rnd(0, 7);
      shard.position.z += rnd(-6, 6);
      shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      shard.userData = {
        velocity: new THREE.Vector3(rnd(-10, 10), rnd(5, 16), rnd(-10, 10)),
        gravity: -26,
        life: rnd(2.8, 6.5),
        age: 0,
        rotSpeed: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
      };
      shard.castShadow = true;
      this.scene.add(shard);
      this.debris.push(shard);
    }
  }

  spawnParticles(count = 320, center = new THREE.Vector3(0, 13, 0)) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = center.x + rnd(-10, 10);
      pos[i * 3 + 1] = center.y + rnd(0, 12);
      pos[i * 3 + 2] = center.z + rnd(-10, 10);
      const isGold = Math.random() > 0.5;
      col[i * 3] = isGold ? 1 : 0.5;
      col[i * 3 + 1] = isGold ? 0.9 : 0.95;
      col[i * 3 + 2] = isGold ? 0.3 : 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.9 });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.particles.push({ mesh: pts, positions: pos, count, life: new Array(count).fill(0) });
  }

  update(debrisActive, t) {
    // Buildings breathing + fold + window pulse
    this.buildings.forEach((b, i) => {
      const h = b.userData.origHeight;
      const breath = 1 + Math.sin(t * 2.6 + i) * 0.022;
      b.scale.y = h * breath;
      b.position.y = b.userData.origPos.y + Math.sin(t * 2 + i) * 0.16;

      if (b.userData.fold > 0) {
        b.scale.z = Math.max(0.1, 1 - b.userData.fold * 0.95);
        b.rotation.x = b.userData.fold * 0.65;
      }

      const pulse = 0.5 + Math.sin(t * 3.6 + i * 1.1 + b.userData.windowPulseOffset) * 0.5;
      b.children.forEach((c) => {
        if (c.userData && c.userData.baseEmissive) {
          c.material.emissive.copy(c.userData.baseEmissive).multiplyScalar(pulse);
        }
      });

      if (b.userData.accent) {
        const a = 0.5 + Math.sin(t * 5.5 + i) * 0.5;
        b.userData.accent.material.emissiveIntensity = 1.8 + a * 3.5;
      }
    });

    // Lamps flicker
    this.lamps.forEach((lamp, i) => {
      const f = 0.8 + Math.sin(t * 18 + i * 1.9 + lamp.userData.flickerOffset) * 0.2;
      lamp.userData.bulb.material.emissiveIntensity = 6 * f;
      lamp.userData.light.intensity = 40 * f;
      lamp.userData.head.material.emissiveIntensity = 2 * f;
    });

    // Debris physics
    if (debrisActive) {
      this.debris.forEach((shard) => {
        const ud = shard.userData;
        ud.age += 0.016;
        shard.position.x += ud.velocity.x * 0.016;
        shard.position.y += ud.velocity.y * 0.016;
        shard.position.z += ud.velocity.z * 0.016;
        ud.velocity.y += ud.gravity * 0.016;
        shard.rotation.x += ud.rotSpeed.x * 0.016;
        shard.rotation.y += ud.rotSpeed.y * 0.016;
        shard.rotation.z += ud.rotSpeed.z * 0.016;
        shard.material.opacity = Math.max(0, 1 - ud.age / ud.life);
        shard.material.transparent = shard.material.opacity < 1;
      });
    }

    // Particles float
    this.particles.forEach((p) => {
      for (let i = 0; i < p.count; i++) {
        p.positions[i * 3 + 1] += Math.sin(t + i) * 0.01;
        p.life[i] += 0.012;
        if (p.life[i] > 5) { p.life[i] = 0; p.positions[i * 3 + 1] = 4; }
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;
    });
  }
}

/* ========================================================================
   CHARACTER — stylized humanoid with full facial expression rig
   ======================================================================== */
class Character {
  constructor(scene, index, total) {
    this.scene = scene;
    this.index = index;
    this.group = new THREE.Group();
    this.expression = 'neutral';
    this.build(index, total);
    scene.add(this.group);
  }

  build(index, total) {
    const skin = 0xedd8c6;
    const cloth = 0x262636;
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.5 });
    const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.7 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a2a1a, roughness: 0.6 });

    const angle = (index / total) * Math.PI * 2;
    const radius = 17;
    this.group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    this.group.lookAt(0, 0, 0);
    this.group.rotation.y += Math.PI;

    this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16), clothMat);
    this.body.position.y = 1.1;
    this.body.castShadow = true;
    this.group.add(this.body);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 30, 30), skinMat);
    this.head.position.y = 2.5;
    this.head.castShadow = true;
    this.group.add(this.head);

    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 10), skinMat);
    this.neck.position.y = 2.05;
    this.group.add(this.neck);

    this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 18), eyeMat);
    this.eyeL.position.set(-0.28, 0.11, 0.8);
    this.eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 18), eyeMat);
    this.eyeR.position.set(0.28, 0.11, 0.8);
    this.pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), pupilMat);
    this.pupilL.position.set(0, 0, 0.18);
    this.pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), pupilMat);
    this.pupilR.position.set(0, 0, 0.18);
    this.eyeL.add(this.pupilL);
    this.eyeR.add(this.pupilR);
    this.head.add(this.eyeL);
    this.head.add(this.eyeR);

    const browGeo = new THREE.BoxGeometry(0.55, 0.05, 0.04);
    const browMat = new THREE.MeshStandardMaterial({ color: 0x352820 });
    this.browL = new THREE.Mesh(browGeo, browMat);
    this.browL.position.set(-0.28, 0.26, 0.83);
    this.browR = new THREE.Mesh(browGeo, browMat);
    this.browR.position.set(0.28, 0.26, 0.83);
    this.head.add(this.browL);
    this.head.add(this.browR);

    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.06), mouthMat);
    this.mouth.position.set(0, -0.18, 0.83);
    this.head.add(this.mouth);

    this.armL = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 1.2, 12), clothMat);
    this.armL.position.set(-0.9, 1.35, 0);
    this.armL.rotation.z = 0.45;
    this.group.add(this.armL);
    this.armR = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 1.2, 12), clothMat);
    this.armR.position.set(0.9, 1.35, 0);
    this.armR.rotation.z = -0.45;
    this.group.add(this.armR);

    this.legL = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 1.4, 12), clothMat);
    this.legL.position.set(-0.26, 0.33, 0);
    this.group.add(this.legL);
    this.legR = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 1.4, 12), clothMat);
    this.legR.position.set(0.26, 0.33, 0);
    this.group.add(this.legR);

    this.state = {
      armL: 0.45, armR: -0.45,
      legL: 0, legR: 0,
      headY: 2.5,
      mouthOpen: 0.11,
      browY: 0.26,
      blink: 0,
    };
  }

  setExpression(expr) {
    this.expression = expr;
  }

  update(t, beat) {
    const s = this.state;
    const breath = Math.sin(t * 3.4 + this.index) * 0.032;
    this.head.position.y = 2.5 + breath;
    this.body.position.y = 1.1 + breath * 0.5;

    switch (this.expression) {
      case 'wonder':   s.mouthOpen = lerp(s.mouthOpen, 0.24, 0.11); s.browY = lerp(s.browY, 0.34, 0.11); s.blink += 0.03; break;
      case 'awe':      s.mouthOpen = lerp(s.mouthOpen, 0.36, 0.1); s.browY = lerp(s.browY, 0.38, 0.1); s.blink += 0.024; break;
      case 'determination': s.mouthOpen = lerp(s.mouthOpen, 0.13, 0.14); s.browY = lerp(s.browY, 0.16, 0.14); s.blink += 0.04; break;
      case 'calm':     s.mouthOpen = lerp(s.mouthOpen, 0.09, 0.12); s.browY = lerp(s.browY, 0.26, 0.12); s.blink += 0.034; break;
      default:         s.mouthOpen = lerp(s.mouthOpen, 0.11, 0.12); s.browY = lerp(s.browY, 0.26, 0.12); s.blink += 0.024; break;
    }

    this.mouth.scale.y = s.mouthOpen / 0.11;
    this.mouth.position.y = -0.18 - (s.mouthOpen - 0.11) * 0.5;

    this.browL.position.y = s.browY;
    this.browR.position.y = s.browY;
    const browZ = (this.expression === 'wonder' || this.expression === 'awe') ? 0.22 : 0;
    this.browL.rotation.z = -browZ;
    this.browR.rotation.z = browZ;

    const blink = Math.abs(Math.sin(s.blink));
    const eyeScale = blink > 0.99 ? 0.02 : 1;
    this.eyeL.scale.y = eyeScale;
    this.eyeR.scale.y = eyeScale;
    this.pupilL.scale.y = eyeScale;
    this.pupilR.scale.y = eyeScale;

    const drift = Math.sin(t * 2.6 + this.index) * 0.11;
    this.pupilL.position.x = drift;
    this.pupilR.position.x = drift;

    s.armL += 0.16; s.armR -= 0.16;
    this.armL.rotation.z = 0.45 + Math.sin(s.armL) * 0.22;
    this.armR.rotation.z = -0.45 + Math.sin(s.armR) * 0.22;

    s.legL += 0.16; s.legR -= 0.16;
    this.legL.rotation.x = Math.sin(s.legL) * 0.18;
    this.legR.rotation.x = Math.sin(s.legR) * 0.18;

    this.head.rotation.x = Math.sin(t * 2.8 + this.index) * 0.045;

    this.group.lookAt(0, 1, 0);
    this.group.rotation.y += Math.PI;
    this.group.position.y = Math.sin(t * 2 + this.index) * 0.18;
  }

  raiseArms() { this.armL.rotation.z = -1.2; this.armR.rotation.z = 1.2; }
  lowerArms() { this.armL.rotation.z = 0.45; this.armR.rotation.z = -0.45; }
}

/* ========================================================================
   STORY TIMELINE — 18 beats, psychology-driven
   ======================================================================== */
const BEATS = [
  { id: 'hook', start: 0.0, end: 2.5, label: 'ACT I · The Hook',
    cam: { pos: [0, 10, 20], tar: [0, 2, 0], fov: 45, roll: 0 },
    audio: () => {}, chars: 'neutral', env: 'still',
    psych: 'Symmetry = safety. Brain relaxes before we break it.' },
  { id: 'crack', start: 2.5, end: 4.0, label: 'ACT I · The First Crack',
    cam: { pos: [3, 8, 15], tar: [0, 7, 0], fov: 55, roll: 8 },
    audio: () => { audio.playThump({ freq: 40, duration: 0.5, gain: 1.1 }); audio.playNoiseBurst({ duration: 0.1, gain: 1.0, hp: 2000, lp: 9000 }); audio.playStab({ freq: 170, duration: 0.25, gain: 0.7 }); },
    chars: 'wonder', env: 'crack',
    psych: 'Pattern interrupt — surprise locks attention instantly.' },
  { id: 'glass', start: 4.0, end: 5.5, label: 'ACT I · Glass Shatter',
    cam: { pos: [-6, 10, 11], tar: [0, 6, 0], fov: 52, roll: -12 },
    audio: () => { audio.playGlassShatter({ gain: 0.9 }); audio.playRiser({ f0: 160, f1: 1700, duration: 1.0, gain: 0.35 }); },
    chars: 'wonder', env: 'glass',
    psych: 'Breaking glass = high arousal. Viewer leans in.' },
  { id: 'fold', start: 5.5, end: 7.5, label: 'ACT I · Building Fold',
    cam: { pos: [-9, 12, 12], tar: [0, 5, 0], fov: 50, roll: -16 },
    audio: () => { audio.playMetalGroan({ duration: 2.0, gain: 0.6 }); audio.playReverseSwell({ duration: 1.3, gain: 0.4 }); },
    chars: 'awe', env: 'fold',
    psych: 'Physics violation = awe. Novelty releases dopamine.' },
  { id: 'gravity', start: 7.5, end: 9.5, label: 'ACT II · Gravity Bends',
    cam: { pos: [12, 9, 4], tar: [0, 1, 0], fov: 54, roll: 24 },
    audio: () => { audio.playMetalGroan({ duration: 2.2, gain: 0.65 }); audio.playRiser({ f0: 120, f1: 1600, duration: 2.0, gain: 0.38 }); },
    chars: 'awe', env: 'gravity',
    psych: 'Roads ripple like water. Reality feels unstable.' },
  { id: 'awaken', start: 9.5, end: 11.5, label: 'ACT II · Characters Awaken',
    cam: { pos: [0, 5, 18], tar: [0, 2, 0], fov: 48, roll: 0 },
    audio: () => { audio.playVocal({ f: 220, duration: 1.5, gain: 0.32 }); audio.playThump({ freq: 70, duration: 0.18, gain: 0.45, bus: 'music' }); },
    chars: 'awe', env: 'awaken',
    psych: 'Faces trigger mirror neurons — viewer feels their wonder.' },
  { id: 'surge', start: 11.5, end: 13.5, label: 'ACT II · Neon Surge',
    cam: { pos: [6, 8, 12], tar: [0, 3, 0], fov: 64, roll: -12 },
    audio: () => { audio.playSubDrop({ f0: 55, f1: 20, duration: 0.7, gain: 1.1 }); audio.playStab({ freq: 100, duration: 0.35, gain: 0.9 }); audio.playShimmer({ duration: 1.4, gain: 0.35 }); },
    chars: 'determination', env: 'surge',
    psych: 'Sub-bass + shimmer = eargasm. Physical pleasure response.' },
  { id: 'break', start: 13.5, end: 15.5, label: 'ACT III · The Break',
    cam: { pos: [0, 7, 6], tar: [0, 0, 0], fov: 70, roll: 0 },
    audio: () => { audio.playSubDrop({ f0: 50, f1: 16, duration: 1.1, gain: 1.2 }); audio.playNoiseBurst({ duration: 0.8, gain: 1.1, hp: 100, lp: 4800 }); audio.playGlassShatter({ gain: 1.1 }); },
    chars: 'determination', env: 'break',
    psych: 'Maximum destruction. Adrenaline spike. Zero boredom.' },
  { id: 'debris', start: 15.5, end: 17.5, label: 'ACT III · Debris Rain',
    cam: { pos: [-5, 9, 3], tar: [0, 3, 0], fov: 62, roll: 14 },
    audio: () => { audio.playGlassShatter({ gain: 0.8 }); audio.playThump({ freq: 48, duration: 0.35, gain: 0.85 }); },
    chars: 'awe', env: 'debris',
    psych: 'Floating shards = dreamlike. Hypnotic motion holds gaze.' },
  { id: 'zerog', start: 17.5, end: 19.5, label: 'ACT III · Zero-G Dance',
    cam: { pos: [-16, 10, -10], tar: [0, 5, 0], fov: 50, roll: 20 },
    audio: () => { audio.playShimmer({ duration: 2.4, gain: 0.4 }); audio.playVocal({ f: 350, duration: 2.4, gain: 0.26 }); },
    chars: 'awe', env: 'zerog',
    psych: 'Weightlessness = trance. Slow motion deepens hypnosis.' },
  { id: 'reassemble', start: 19.5, end: 21.5, label: 'ACT III · Reassembly',
    cam: { pos: [24, 16, 24], tar: [0, 2, 0], fov: 48, roll: 0 },
    audio: () => { audio.playThump({ freq: 75, duration: 0.5, gain: 0.8 }); audio.playStab({ freq: 150, duration: 0.55, gain: 0.7 }); },
    chars: 'calm', env: 'reassemble',
    psych: 'Tension resolves. Brain rewards closure with satisfaction.' },
  { id: 'spiral', start: 21.5, end: 23.5, label: 'ACT IV · Spiral City',
    cam: { pos: [36, 26, -14], tar: [0, 7, 0], fov: 46, roll: -8 },
    audio: () => { audio.playShimmer({ duration: 3.4, gain: 0.3 }); audio.startHeartbeat(60); },
    chars: 'calm', env: 'spiral',
    psych: 'New order from chaos = meaning. Hope keeps viewer watching.' },
  { id: 'hope', start: 23.5, end: 25.5, label: 'ACT IV · Characters Hopeful',
    cam: { pos: [0, 9, 26], tar: [0, 5, 0], fov: 46, roll: 0 },
    audio: () => { audio.playShimmer({ duration: 2.2, gain: 0.28 }); audio.playVocal({ f: 290, duration: 2.2, gain: 0.25 }); },
    chars: 'calm', env: 'hope',
    psych: 'Calm faces after chaos = relief. Emotional payoff complete.' },
  { id: 'stars', start: 25.5, end: 27.5, label: 'ACT IV · Star Field',
    cam: { pos: [44, 34, -24], tar: [0, 9, 0], fov: 44, roll: -6 },
    audio: () => { audio.playShimmer({ duration: 2.7, gain: 0.32 }); },
    chars: 'calm', env: 'stars',
    psych: 'Cosmic scale = eye-opening. Makes viewer think.' },
  { id: 'loop', start: 27.5, end: 30.0, label: 'ACT IV · Loop Point',
    cam: { pos: [0, 10, 20], tar: [0, 2, 0], fov: 45, roll: 0 },
    audio: () => { audio.stopHeartbeat(); audio.playThump({ freq: 58, duration: 0.35, gain: 0.6 }); },
    chars: 'neutral', env: 'still',
    psych: 'Symmetry returns. Loopable = rewatchable. Hypnotized.' },
];

/* ========================================================================
   MAIN APP
   ======================================================================== */
export default class TabahiApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.rig = null;
    this.env = null;
    this.chars = [];
    this.clock = new THREE.Clock();
    this.startTime = null;
    this.isPlaying = false;
    this.hasStarted = false;
    this.currentBeatIndex = -1;
    this.debrisActive = false;
    this.buildingsFold = false;
    this.lastTime = performance.now();
    this.frames = 0;
    this.fps = 0;
    this.fpsTime = performance.now();

    this.bloomPass = null;
    this.vignettePass = null;
    this.grainPass = null;
    this.bokehPass = null;

    this.uiBeat = document.getElementById('beat-label');
    this.uiHint = document.getElementById('hint');
    this.uiFps = document.getElementById('fps');
    this.uiBeatNum = document.getElementById('beat');
    this.uiCam = document.getElementById('cam-mode');
    this.titleCard = document.getElementById('title-card');
    this.flash = document.getElementById('flash');
    this.uiProgress = document.getElementById('story-progress');

    this.init();
    this.bindEvents();
  }

  init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.COLORS.noir);
    this.scene.fog = new THREE.FogExp2(CONFIG.COLORS.noir, 0.026);

    // Camera
    this.camera = new THREE.PerspectiveCamera(CONFIG.FOV, window.innerWidth / window.innerHeight, CONFIG.NEAR, CONFIG.FAR);
    this.camera.position.set(0, 10, 20);

    // Rig
    this.rig = new CameraRig(this.camera);
    this.rig.setPose(new THREE.Vector3(0, 10, 20), new THREE.Vector3(0, 2, 0), 45, 0);

    // Lighting — cinematic three-point + practical
    const ambient = new THREE.AmbientLight(0xffffff, 0.28);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(16, 20, 14);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(CONFIG.COLORS.cyan, 1.2);
    fillLight.position.set(-16, 8, -14);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(CONFIG.COLORS.violet, 1.6);
    rimLight.position.set(0, 16, -18);
    this.scene.add(rimLight);

    const spot = new THREE.SpotLight(CONFIG.COLORS.orange, 60, 52, 0.45, 0.5, 1);
    spot.position.set(-26, 14, -20);
    spot.lookAt(0, 0, 0);
    spot.castShadow = true;
    this.scene.add(spot);

    // Environment & Characters
    this.env = new Environment(this.scene);
    const totalChars = 6;
    for (let i = 0; i < totalChars; i++) {
      this.chars.push(new Character(this.scene, i, totalChars));
    }

    // Post-processing composer
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      CONFIG.BLOOM.strength,
      CONFIG.BLOOM.radius,
      CONFIG.BLOOM.threshold
    );
    this.composer.addPass(this.bloomPass);

    // Bokeh depth of field
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: 15.0,
      aperture: 0.018,
      maxblur: 0.012,
    });
    this.composer.addPass(this.bokehPass);

    // Vignette + color grade
    this.vignettePass = new ShaderPass(VignetteGradeShader);
    this.composer.addPass(this.vignettePass);

    // Film grain
    this.filmPass = new FilmPass(0.35, 0.05, 648, false);
    this.composer.addPass(this.filmPass);

    // Custom grain shader for extra texture
    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);

    // Gamma correction
    this.composer.addPass(new ShaderPass(GammaCorrectionShader));

    // FXAA anti-aliasing
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
    this.composer.addPass(fxaaPass);

    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.onResize());
  }

  bindEvents() {
    const start = () => {
      if (this.hasStarted) return;
      this.hasStarted = true;
      this.startTime = performance.now();
      this.isPlaying = true;
      audio.init().then(() => {
        audio.startAmbientDrone();
        this.uiHint.classList.remove('visible');
        this.titleCard.classList.add('hidden');
      });
      this.uiHint.classList.add('hidden');
    };
    this.container.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.hasStarted) start();
      if (e.code === 'KeyR') this.restart();
    });
  }

  restart() {
    this.startTime = performance.now();
    this.currentBeatIndex = -1;
    this.debrisActive = false;
    this.buildingsFold = false;
    this.env.debris.forEach((d) => this.scene.remove(d));
    this.env.debris = [];
    this.chars.forEach((c) => c.setExpression('neutral'));
    audio.stopHeartbeat();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.bloomPass) this.bloomPass.resolution.set(w, h);
  }

  getBeat(t) {
    for (let i = 0; i < BEATS.length; i++) {
      if (t >= BEATS[i].start && t < BEATS[i].end) {
        return { index: i, beat: BEATS[i], local: t - BEATS[i].start };
      }
    }
    const last = BEATS[BEATS.length - 1];
    return { index: BEATS.length - 1, beat: last, local: last.end - last.start };
  }

  updateStory(delta, elapsed) {
    const loopT = elapsed % CONFIG.DURATION;
    const { index, beat, local } = this.getBeat(loopT);

    if (index !== this.currentBeatIndex) {
      this.currentBeatIndex = index;

      if (beat.audio) beat.audio();

      this.uiBeat.textContent = beat.label;
      this.uiBeat.classList.add('visible');
      void this.uiBeat.offsetHeight;
      this.uiBeat.classList.remove('visible');
      setTimeout(() => this.uiBeat.classList.add('visible'), 50);

      this.uiProgress.style.width = ((loopT / CONFIG.DURATION) * 100) + '%';
      this.uiBeatNum.textContent = beat.id.toUpperCase();
      this.uiCam.textContent = 'Cinematic';

      if (['crack', 'surge', 'break'].includes(beat.id)) {
        this.flash.classList.add('active');
        setTimeout(() => this.flash.classList.remove('active'), 120);
        this.rig.triggerShake(beat.id === 'break' ? 0.16 : 0.08, 0.45);
      }

      this.chars.forEach((c) => c.setExpression(beat.chars));

      if (beat.env === 'break') {
        this.env.spawnDebris(210, new THREE.Vector3(0, 10, 0));
        this.debrisActive = true;
      }
      if (beat.env === 'surge') {
        this.chars.forEach((c) => c.raiseArms());
      }
      if (beat.env === 'reassemble') {
        this.chars.forEach((c) => c.lowerArms());
      }
      if (beat.env === 'fold') {
        this.buildingsFold = true;
      }
      if (beat.env === 'spiral') {
        this.env.spawnParticles(320, new THREE.Vector3(0, 13, 0));
      }
    }

    this.uiProgress.style.width = ((loopT / CONFIG.DURATION) * 100) + '%';

    // Camera interpolation within beat
    if (index === 0) {
      // Wrap from last beat to first (loop transition)
      const prev = BEATS[BEATS.length - 1];
      const prevDur = prev.end - prev.start;
      const wrapT = (loopT + CONFIG.DURATION - prev.start) % CONFIG.DURATION;
      const t = easeInOutCubic(wrapT / prevDur);
      this.rig.interpolate(
        new THREE.Vector3(...prev.cam.pos), new THREE.Vector3(...prev.cam.tar), prev.cam.fov, prev.cam.roll,
        new THREE.Vector3(...beat.cam.pos), new THREE.Vector3(...beat.cam.tar), beat.cam.fov, beat.cam.roll,
        t
      );
    } else {
      const prev = BEATS[index - 1];
      const beatDur = beat.end - beat.start;
      const tt = local / beatDur;
      const t = easeInOutCubic(tt);
      this.rig.interpolate(
        new THREE.Vector3(...prev.cam.pos), new THREE.Vector3(...prev.cam.tar), prev.cam.fov, prev.cam.roll,
        new THREE.Vector3(...beat.cam.pos), new THREE.Vector3(...beat.cam.tar), beat.cam.fov, beat.cam.roll,
        t
      );
    }

    this.rig.updateShake(performance.now());
    this.env.update(this.debrisActive, elapsed);

    if (this.buildingsFold && beat.env === 'fold') {
      const fold = Math.min(1, local / 1.5);
      this.env.buildings.forEach((b) => { b.userData.fold = fold; });
    } else if (beat.env !== 'fold') {
      this.env.buildings.forEach((b) => {
        b.userData.fold = Math.max(0, b.userData.fold - 0.02);
      });
    }

    this.chars.forEach((c) => c.update(elapsed, beat));

    // Post-processing dynamics
    const impact = ['crack', 'surge', 'break'].includes(beat.id);
    const ab = impact ? 0.022 * (1 - local / 0.5) : 0;
    if (this.vignettePass) this.vignettePass.uniforms.chromaticAberration.value = Math.max(0, ab);

    if (this.bloomPass) {
      const base = (beat.id === 'spiral' || beat.id === 'loop' || beat.id === 'surge') ? 2.2 : 1.7;
      const pulse = Math.sin(elapsed * 4) * 0.25;
      this.bloomPass.strength = THREE.MathUtils.lerp(this.bloomPass.strength, base + pulse, 0.05);
    }

    // Bokeh focus follows story
    if (this.bokehPass) {
      const focus = beat.id === 'awaken' || beat.id === 'hope' ? 8 : 18;
      this.bokehPass.uniforms.focus.value = THREE.MathUtils.lerp(this.bokehPass.uniforms.focus.value, focus, 0.03);
    }

    this.uiFps.textContent = Math.round(this.fps);
  }

  animate() {
    if (!this.isPlaying) return;
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const elapsed = this.hasStarted ? (now - this.startTime) / 1000 : 0;

    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.fpsTime = now;
    }

    if (this.hasStarted) this.updateStory(delta, elapsed);

    this.composer.render();
  }

  start() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.startTime = performance.now();
      this.animate();
    }
  }
}

const app = new TabahiApp();
app.start();
