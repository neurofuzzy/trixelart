"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TrixelModel } from "@/lib/mesh-export";

// Grain preview stripes: spacing of the light/dark line pairs (model mm) and how
// far they push lightness (±fraction). Tight + subtle, just to read the angle.
const GRAIN_SPACING_MM = 1.5;
const GRAIN_AMOUNT = 0.14;

/** Paint faint directional stripes on the up/down-facing faces of a body so its
 *  grain angle is visible. The line direction is `angleDeg`; stripes alternate
 *  perpendicular to it. Gated to near-horizontal faces (via the geometric face
 *  normal from screen-space derivatives) so walls stay clean. */
function applyGrainShader(mat: THREE.MeshStandardMaterial, angleDeg: number) {
  const theta = (angleDeg * Math.PI) / 180;
  // Perpendicular to the line direction, in model XY — stripes vary along this.
  const dir = new THREE.Vector2(-Math.sin(theta), Math.cos(theta));
  const freq = (2 * Math.PI) / GRAIN_SPACING_MM;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrainDir = { value: dir };
    shader.uniforms.uGrainFreq = { value: freq };
    shader.uniforms.uGrainAmount = { value: GRAIN_AMOUNT };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vGrainWPos;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGrainWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uGrainDir;\nuniform float uGrainFreq;\nuniform float uGrainAmount;\nvarying vec3 vGrainWPos;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 gdx = dFdx(vGrainWPos);
  vec3 gdy = dFdy(vGrainWPos);
  float gtop = smoothstep(0.55, 0.9, abs(normalize(cross(gdx, gdy)).z));
  float ph = dot(vGrainWPos.xy, uGrainDir) * uGrainFreq;
  float ln = smoothstep(-0.5, 0.5, sin(ph)) * 2.0 - 1.0;
  diffuseColor.rgb *= 1.0 + gtop * uGrainAmount * ln;
}`,
      );
  };
  // Distinct from the base body's un-patched program so three doesn't hand us
  // the stripe-less shader (default cache key ignores onBeforeCompile edits).
  mat.customProgramCacheKey = () => "trixel-grain";
}

function buildGroup(m: TrixelModel): THREE.Group {
  const group = new THREE.Group();
  for (const body of m.bodies) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(body.positions, 3),
    );
    geo.setIndex(body.indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(body.colorHex),
      roughness: 0.5,
      metalness: 0.15,
      flatShading: true,
    });
    if (body.grainAngle !== null) applyGrainShader(mat, body.grainAngle);
    group.add(new THREE.Mesh(geo, mat));
  }
  return group;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

function boundsCenter(group: THREE.Group): {
  center: THREE.Vector3;
  radius: number;
} {
  const sphere = new THREE.Box3()
    .setFromObject(group)
    .getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center, radius: sphere.radius || 50 };
}

/** Vertical studio-gradient texture (lighter top → darker bottom) used both as
 *  the flat screen background and, mapped as an equirect, as the reflection
 *  environment so faceted faces catch soft form-defining highlights. */
function makeGradientTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#6b7486"); // top
  g.addColorStop(0.55, "#3a3f49");
  g.addColorStop(1, "#17191d"); // bottom
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Orbitable 3D preview of the export model, lit by a camera-tracking
 *  "headlamp" (a directional light kept at the eye, aimed at the pivot) plus a
 *  soft hemisphere fill so shadowed faces stay readable. Vanilla three.js so it
 *  loads as its own chunk (see the dynamic import in Export3DDialog). */
export function Model3DPreview({ model }: { model: TrixelModel }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const framedRef = useRef(false);

  // Mount: renderer, scene, camera, controls, lights, render loop. No geometry
  // here — the model effect owns that — so this effect needs no data deps.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Studio gradient: flat texture as the screen background, plus a PMREM'd
    // copy as the reflection environment so both dark and light faces read.
    const bgTex = makeGradientTexture();
    scene.background = bgTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envSrc = makeGradientTexture();
    envSrc.mapping = THREE.EquirectangularReflectionMapping;
    const envRT = pmrem.fromEquirectangular(envSrc);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.5;
    envSrc.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      10000,
    );
    camera.up.set(0, 0, 1); // model is Z-up
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controlsRef.current = controls;

    // Headlamp: directional light kept at the eye, aimed at the orbit pivot.
    // Eased a touch since the gradient environment now adds reflective fill.
    const headlamp = new THREE.DirectionalLight(0xffffff, 2.0);
    scene.add(headlamp);
    scene.add(headlamp.target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a30, 0.4));

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      headlamp.position.copy(camera.position);
      headlamp.target.position.copy(controls.target);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      bgTex.dispose();
      envRT.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      framedRef.current = false;
    };
  }, []);

  // (Re)build geometry when the model (options) change. Frames the camera on the
  // first build; afterwards only re-centers the pivot so the orbit is preserved.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    const group = buildGroup(model);
    scene.add(group);
    const { center, radius } = boundsCenter(group);
    controls.target.copy(center);
    if (!framedRef.current) {
      const dir = new THREE.Vector3(0.55, -1, 0.8).normalize();
      camera.position.copy(center).addScaledVector(dir, radius * 2.6);
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      framedRef.current = true;
    }
    controls.update();

    return () => {
      scene.remove(group);
      disposeGroup(group);
    };
  }, [model]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[240px] w-full rounded-md border cursor-grab active:cursor-grabbing overflow-hidden"
    />
  );
}
