'use client';

import { useEffect, useRef } from 'react';

/* ──────────────────────────────────────────────────────────────
   MEMORY FOAM PROVIDER
   Global SVG displacement-map effect on ALL <button> elements.
   Uses event delegation — mount once in layout, works everywhere.

   How it works:
   1. Hidden SVG <filter> with feDisplacementMap
   2. On mousedown/pointerdown on any <button>, generates a canvas
      displacement map centered on the click point with Gaussian falloff
   3. Quick sink animation (150ms) + slow return (1200ms)
   ────────────────────────────────────────────────────────────── */

const FILTER_ID = 'memory-foam-global';
const MAX_SCALE = 50;
const SINK_DURATION = 150;
const RETURN_DURATION = 1200;
const RADIUS = 60;
const STRENGTH_MAX = 1.2;
const SIGMA = RADIUS / 3;

function createDisplacementMap(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const bufferRadius = RADIUS * 1.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = centerX - x;
      const dy = centerY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < bufferRadius) {
        const normX = dx / (dist || 1);
        const normY = dy / (dist || 1);
        // Gaussian strength for softer, more natural falloff
        const strength = STRENGTH_MAX * Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA));
        const dispX = strength * normX;
        const dispY = strength * normY;

        imageData.data[idx]     = 127 + dispX * 127;
        imageData.data[idx + 1] = 127 + dispY * 127;
        imageData.data[idx + 2] = 127;
        imageData.data[idx + 3] = 255;
      } else {
        imageData.data[idx]     = 127;
        imageData.data[idx + 1] = 127;
        imageData.data[idx + 2] = 127;
        imageData.data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

export default function MemoryFoamProvider() {
  const mapImageRef = useRef<SVGFEImageElement | null>(null);
  const dispMapRef = useRef<SVGFEDisplacementMapElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const isPressedRef = useRef(false);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const mapImage = mapImageRef.current;
    const dispMap = dispMapRef.current;
    if (!mapImage || !dispMap) return;

    const handleDown = (e: PointerEvent | MouseEvent) => {
      // Walk up from target to find nearest <button>
      const btn = (e.target as HTMLElement).closest?.('button') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;

      // Skip buttons that opt out
      if (btn.dataset.noFoam !== undefined) return;

      if (isPressedRef.current) return;
      isPressedRef.current = true;
      activeButtonRef.current = btn;

      const rect = btn.getBoundingClientRect();
      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);

      // Apply filter to the button
      btn.style.filter = `url(#${FILTER_ID})`;

      // Generate displacement map
      const mapUrl = createDisplacementMap(centerX, centerY, width, height);
      mapImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mapUrl);
      mapImage.setAttribute('width', String(width));
      mapImage.setAttribute('height', String(height));
      mapImage.setAttribute('result', 'map');

      // Animate sink
      dispMap.setAttribute('scale', '0');
      cancelAnimationFrame(animFrameRef.current);
      const startTime = Date.now();
      const dm = dispMap; // local ref for closure

      function sinkAnim() {
        let progress = (Date.now() - startTime) / SINK_DURATION;
        progress = Math.min(progress, 1);
        // Ease-in via sin for softness
        dm.setAttribute('scale', String(MAX_SCALE * Math.sin(progress * Math.PI / 2)));
        if (progress < 1 && isPressedRef.current) {
          animFrameRef.current = requestAnimationFrame(sinkAnim);
        }
      }
      sinkAnim();
    };

    const handleUp = () => {
      if (!isPressedRef.current || !dispMap) return;
      isPressedRef.current = false;
      cancelAnimationFrame(animFrameRef.current);

      const dm = dispMap; // local ref for closure
      const currentScale = parseFloat(dm.getAttribute('scale') || String(MAX_SCALE));
      const btn = activeButtonRef.current;
      const startTime = Date.now();

      function returnAnim() {
        let progress = (Date.now() - startTime) / RETURN_DURATION;
        progress = Math.min(progress, 1);
        // Ease-out via sqrt for slow memory-foam return
        const scale = currentScale * (1 - Math.pow(progress, 0.5));
        dm.setAttribute('scale', String(scale));
        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(returnAnim);
        } else {
          dm.setAttribute('scale', '0');
          // Remove filter after animation completes
          if (btn) btn.style.filter = '';
          activeButtonRef.current = null;
        }
      }
      returnAnim();
    };

    // Event delegation on document
    document.addEventListener('pointerdown', handleDown, { passive: true });
    document.addEventListener('pointerup', handleUp, { passive: true });
    document.addEventListener('pointercancel', handleUp, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handleDown);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <svg
      className="absolute w-0 h-0 overflow-hidden"
      style={{ position: 'absolute', width: 0, height: 0 }}
      aria-hidden="true"
    >
      <defs>
        <filter id={FILTER_ID} colorInterpolationFilters="sRGB">
          <feImage ref={mapImageRef} preserveAspectRatio="none" />
          <feDisplacementMap
            ref={dispMapRef}
            in="SourceGraphic"
            in2="map"
            scale={0}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
