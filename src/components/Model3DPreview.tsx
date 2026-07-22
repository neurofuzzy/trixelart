"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TrixelModel } from "@/lib/mesh-export";

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
    const headlamp = new THREE.DirectionalLight(0xffffff, 2.6);
    scene.add(headlamp);
    scene.add(headlamp.target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a30, 0.55));

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
      className="h-[240px] w-full rounded-md border bg-[repeating-conic-gradient(rgba(255,255,255,0.04)_0%_25%,_transparent_0%_50%)_50%_/_16px_16px] cursor-grab active:cursor-grabbing overflow-hidden"
    />
  );
}
