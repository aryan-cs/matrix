import { useEffect, useRef } from "react";
import * as THREE from "three";

const GRID_X = 110;
const GRID_Z = 70;
const POINT_SPACING = 1.18;
const BASE_WAVE_SPEED = 1.25;
const RIPPLE_SPEED = 10.5;
const RIPPLE_WIDTH = 0.28;
const RIPPLE_AMPLITUDE = 1.9;

function DotWaveBackground() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 31, 54);
    camera.lookAt(0, -3, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(renderer.domElement);

    const count = GRID_X * GRID_Z;
    const positions = new Float32Array(count * 3);
    const basePositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const startX = -((GRID_X - 1) * POINT_SPACING) / 2;
    const startZ = -((GRID_Z - 1) * POINT_SPACING) / 2;
    const colorNear = new THREE.Color("#ffffff");
    const colorFar = new THREE.Color("#9a9a9a");

    let pointer = 0;
    for (let z = 0; z < GRID_Z; z += 1) {
      for (let x = 0; x < GRID_X; x += 1) {
        const px = startX + x * POINT_SPACING;
        const pz = startZ + z * POINT_SPACING;

        positions[pointer] = px;
        positions[pointer + 1] = 0;
        positions[pointer + 2] = pz;

        basePositions[pointer] = px;
        basePositions[pointer + 1] = 0;
        basePositions[pointer + 2] = pz;

        const blend = z / (GRID_Z - 1);
        const pointColor = colorFar.clone().lerp(colorNear, blend * 0.95);
        colors[pointer] = pointColor.r;
        colors[pointer + 1] = pointColor.g;
        colors[pointer + 2] = pointColor.b;

        pointer += 3;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.24,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const clock = new THREE.Clock();
    let rafId;

    const animate = () => {
      const t = clock.getElapsedTime();
      const pos = geometry.attributes.position.array;

      const center1X = Math.sin(t * 0.26) * 15;
      const center1Z = Math.cos(t * 0.22) * 10;
      const center2X = Math.sin(t * 0.34 + 1.3) * 21;
      const center2Z = Math.cos(t * 0.28 + 0.4) * 16;

      for (let i = 0; i < count; i += 1) {
        const idx = i * 3;
        const x = basePositions[idx];
        const z = basePositions[idx + 2];

        const baseWave = Math.sin(x * 0.2 + t * BASE_WAVE_SPEED) * 0.45 + Math.cos(z * 0.18 - t * 0.88) * 0.55;

        const d1 = Math.hypot(x - center1X, z - center1Z);
        const d2 = Math.hypot(x - center2X, z - center2Z);
        const ripple1 = Math.sin(d1 * 1.1 - t * RIPPLE_SPEED) * Math.exp(-d1 * RIPPLE_WIDTH);
        const ripple2 = Math.sin(d2 * 1.22 - t * (RIPPLE_SPEED * 0.9)) * Math.exp(-d2 * (RIPPLE_WIDTH * 0.8));

        pos[idx + 1] = baseWave + (ripple1 + ripple2) * RIPPLE_AMPLITUDE;
      }

      geometry.attributes.position.needsUpdate = true;
      points.rotation.y = Math.sin(t * 0.12) * 0.08;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const { innerWidth, innerHeight } = window;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mountNode) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="wave-bg" aria-hidden="true">
      <div ref={mountRef} className="wave-canvas" />
      <div className="wave-atmosphere" />
    </div>
  );
}

export default DotWaveBackground;
