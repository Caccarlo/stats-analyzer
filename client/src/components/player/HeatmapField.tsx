import { useEffect, useRef, useState } from 'react';
import { getPlayerMatchHeatmap } from '@/api/sofascore';
import type { HeatmapPoint } from '@/types';

interface HeatmapFieldProps {
  eventId: number;
  playerId: number;
  isHome: boolean;
  orientation?: 'portrait' | 'landscape';
  maxWidth?: number;
  maxCap?: number;
}

const FIELD_W = 680;
const FIELD_H = 1050;
const FIELD_L_W = 1050;
const FIELD_L_H = 680;

function toScreen(px: number, py: number, isHome: boolean): { x: number; y: number } {
  if (isHome) {
    return { x: (py / 100) * FIELD_W, y: (px / 100) * FIELD_H };
  }
  return { x: (1 - py / 100) * FIELD_W, y: (1 - px / 100) * FIELD_H };
}

function toScreenLandscape(px: number, py: number, isHome: boolean): { x: number; y: number } {
  if (isHome) {
    return { x: (px / 100) * FIELD_L_W, y: (1 - py / 100) * FIELD_L_H };
  }
  return { x: (1 - px / 100) * FIELD_L_W, y: (py / 100) * FIELD_L_H };
}

function drawField(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sx = w / FIELD_W;
  const sy = h / FIELD_H;

  ctx.fillStyle = '#1a3320';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2a5535';
  ctx.lineWidth = 2 * sx;

  ctx.strokeRect(10 * sx, 10 * sy, 660 * sx, 1030 * sy);
  ctx.beginPath();
  ctx.moveTo(10 * sx, 525 * sy);
  ctx.lineTo(670 * sx, 525 * sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(340 * sx, 525 * sy, 91.5 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(138 * sx, 10 * sy, 404 * sx, 165 * sy);
  ctx.strokeRect(218 * sx, 10 * sy, 244 * sx, 55 * sy);
  ctx.strokeRect(138 * sx, 875 * sy, 404 * sx, 165 * sy);
  ctx.strokeRect(218 * sx, 985 * sy, 244 * sx, 55 * sy);
}

function drawFieldLandscape(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sx = w / FIELD_L_W;
  const sy = h / FIELD_L_H;

  ctx.fillStyle = '#1a3320';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2a5535';
  ctx.lineWidth = 2 * sx;

  ctx.strokeRect(10 * sx, 10 * sy, 1030 * sx, 660 * sy);
  ctx.beginPath();
  ctx.moveTo(525 * sx, 10 * sy);
  ctx.lineTo(525 * sx, 670 * sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(525 * sx, 340 * sy, 91.5 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(10 * sx, 138 * sy, 165 * sx, 404 * sy);
  ctx.strokeRect(10 * sx, 218 * sy, 55 * sx, 244 * sy);
  ctx.strokeRect(875 * sx, 138 * sy, 165 * sx, 404 * sy);
  ctx.strokeRect(985 * sx, 218 * sy, 55 * sx, 244 * sy);
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  points: HeatmapPoint[],
  w: number,
  h: number,
  isHome: boolean,
  orientation: 'portrait' | 'landscape',
) {
  if (points.length === 0) return;

  const fw = orientation === 'landscape' ? FIELD_L_W : FIELD_W;
  const fh = orientation === 'landscape' ? FIELD_L_H : FIELD_H;
  const sx = w / fw;
  const sy = h / fh;
  const radius = 60 * Math.max(sx, sy);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return;

  for (const p of points) {
    const screen =
      orientation === 'landscape'
        ? toScreenLandscape(p.x, p.y, isHome)
        : toScreen(p.x, p.y, isHome);
    const cx = screen.x * sx;
    const cy = screen.y * sy;

    const grad = offCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0,0,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    offCtx.fillStyle = grad;
    offCtx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  const imageData = offCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;

    const t = Math.min(alpha / 180, 1);
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.5) {
      const s = t * 2;
      r = Math.round(s * 255);
      g = 255;
      b = 0;
    } else {
      const s = (t - 0.5) * 2;
      r = 255;
      g = Math.round((1 - s) * 255);
      b = 0;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.min(255, Math.round(t * 200 + 40));
  }

  offCtx.putImageData(imageData, 0, 0);
  ctx.globalAlpha = 0.7;
  ctx.drawImage(offscreen, 0, 0);
  ctx.globalAlpha = 1.0;
}

export default function HeatmapField({
  eventId,
  playerId,
  isHome,
  orientation = 'portrait',
  maxWidth,
  maxCap,
}: HeatmapFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getPlayerMatchHeatmap(eventId, playerId).then((data) => {
      if (!cancelled) {
        setPoints(data);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [eventId, playerId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function redraw() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w === 0 || h === 0) return;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (orientation === 'landscape') {
        drawFieldLandscape(ctx, w, h);
      } else {
        drawField(ctx, w, h);
      }

      if (!loading) {
        drawHeatmap(ctx, points, w, h, isHome, orientation);
      }
    }

    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points, loading, isHome, orientation]);

  const isLandscape = orientation === 'landscape';
  const defaultMaxWidth = maxCap ?? (isLandscape ? 124 : 116);
  const effectiveMaxWidth = Math.min(maxWidth ?? defaultMaxWidth, defaultMaxWidth);
  const aspectRatio = isLandscape ? '105/68' : '68/105';

  return (
    <div
      className="relative w-full"
      style={{ maxWidth: `${effectiveMaxWidth}px`, aspectRatio }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg border border-field-lines"
        style={{ aspectRatio }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 border-2 border-neon border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!loading && points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-text-muted text-[8px]">Nessun dato</span>
        </div>
      )}
    </div>
  );
}
