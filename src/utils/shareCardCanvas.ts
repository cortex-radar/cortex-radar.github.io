import type {
  LiteracyLevel,
  LiteracySpectrumPayload,
  SpatialSignal,
} from '../../shared/types';
import { SECTOR_BY_ID } from '../../shared/types';
import { buildCortexDeepLinkUrl } from './deepLink';
import { getActiveLensTakeaway, LENS_SHORT_LABELS } from './signalRanking';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        for (let j = i + 1; j < words.length; j++) {
          const nextTry = `${current} ${words[j]}`;
          if (ctx.measureText(`${nextTry}…`).width <= maxWidth) {
            current = nextTry;
          } else {
            current = `${current.replace(/[,;:-]+$/, '')}…`;
            break;
          }
        }
        lines.push(current);
        return lines;
      }
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }
  return lines;
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Generates a crisp 1200x630 Smoked-Obsidian (#09090B) executive share card PNG Blob
 * containing sector badge, title, L1 Everyday Analogy, L5 Pro Verdict, and CORTEX deep-link watermark.
 */
export async function renderShareCardPngBlob(params: {
  signal: SpatialSignal;
  cleanHeadline: string;
  literacy: LiteracySpectrumPayload;
  activeLevel: LiteracyLevel;
}): Promise<{ blob: Blob; deepLinkUrl: string; filename: string }> {
  const { signal, cleanHeadline, literacy, activeLevel } = params;
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const sec = SECTOR_BY_ID[signal.primarySector];
  const deepLinkUrl = buildCortexDeepLinkUrl(signal.id, activeLevel);

  // 1. Smoked-Obsidian #09090B Canvas + Subtle Sector Radial Glow
  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.86, H * 0.14, 10, W * 0.86, H * 0.14, 460);
  glow.addColorStop(0, `${sec.colorHex}26`);
  glow.addColorStop(0.55, 'rgba(45, 212, 191, 0.05)');
  glow.addColorStop(1, 'rgba(9, 9, 11, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Precision 24px Subtle Aerospace Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.024)';
  ctx.lineWidth = 1;
  for (let gx = 48; gx < W; gx += 48) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();
  }
  for (let gy = 48; gy < H; gy += 48) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
  }

  // Outer Smoked-Obsidian Specular Frame
  drawRoundedRect(ctx, 24, 24, W - 48, H - 48, 20);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Deterministic Waveform Telemetry Accent in Top-Right
  const seed = hashSeed(signal.id);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 36; i++) {
    const px = W - 310 + i * 7.2;
    const phase = ((seed % 97) * 0.13) + i * 0.42;
    const amp = 8 + ((seed >> (i % 12)) & 7) * 1.4;
    const py = 64 + Math.sin(phase) * amp * Math.sin((i / 36) * Math.PI);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = `${sec.colorHex}99`;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  // 2. Top Metadata Strip (Sector Badge + Origin Source + Readiness)
  const padX = 56;
  let curY = 62;

  ctx.font = '600 13px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const secText = `${sec.code} · ${sec.name.toUpperCase()}`;
  const secW = ctx.measureText(secText).width + 34;
  drawRoundedRect(ctx, padX, curY - 16, secW, 28, 7);
  ctx.fillStyle = 'rgba(24, 24, 27, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 275, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(padX + 14, curY - 2, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = sec.colorHex;
  ctx.fill();

  ctx.fillStyle = '#F4F4F5';
  ctx.textBaseline = 'middle';
  ctx.fillText(secText, padX + 25, curY - 1);

  const originText = (signal.originFeedName || signal.source).slice(0, 34);
  const originX = padX + secW + 10;
  const originW = ctx.measureText(originText).width + 24;
  drawRoundedRect(ctx, originX, curY - 16, originW, 28, 7);
  ctx.fillStyle = 'rgba(24, 24, 27, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
  ctx.stroke();
  ctx.fillStyle = '#5EEAD4';
  ctx.fillText(originText, originX + 12, curY - 1);

  const readyText = `${signal.readiness} · ${signal.finOps === 'REDUCER' ? 'OPEX REDUCER' : signal.risk + ' RISK'}`;
  const readyX = originX + originW + 10;
  const readyW = ctx.measureText(readyText).width + 22;
  drawRoundedRect(ctx, readyX, curY - 16, readyW, 28, 7);
  ctx.fillStyle = 'rgba(24, 24, 27, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.stroke();
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText(readyText, readyX + 11, curY - 1);

  // 3. Headline (2 lines max, tight geometric sans)
  curY = 114;
  ctx.font = '700 30px "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#FAFAFA';
  ctx.textBaseline = 'top';
  const titleLines = wrapLines(ctx, cleanHeadline, W - padX * 2, 2);
  for (const line of titleLines) {
    ctx.fillText(line, padX, curY);
    curY += 38;
  }

  // 4. Dual Intelligence Panels: Active Lens Takeaway + Companion Perspective
  const boxTop = Math.max(198, curY + 14);
  const boxW = W - padX * 2;
  const activeTakeaway = getActiveLensTakeaway(signal, literacy, activeLevel);
  const companionLevel: LiteracyLevel = activeLevel === 1 ? 5 : 1;
  const companionTakeaway = getActiveLensTakeaway(signal, literacy, companionLevel);

  // Panel A: Active Lens Takeaway
  const p1H = 162;
  drawRoundedRect(ctx, padX, boxTop, boxW, p1H, 12);
  ctx.fillStyle = 'rgba(16, 16, 20, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.34)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Teal left accent bar
  drawRoundedRect(ctx, padX, boxTop, 4, p1H, 2);
  ctx.fillStyle = '#2DD4BF';
  ctx.fill();

  ctx.font = '600 12px "Geist Mono", ui-monospace, monospace';
  ctx.fillStyle = '#2DD4BF';
  ctx.fillText(
    `L${activeLevel} · ${LENS_SHORT_LABELS[activeLevel].toUpperCase()} TAKEAWAY`,
    padX + 20,
    boxTop + 16
  );

  ctx.font = '400 18px "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#F4F4F5';
  const l1Lines = wrapLines(ctx, activeTakeaway.text, boxW - 40, 4);
  let l1Y = boxTop + 42;
  for (const line of l1Lines) {
    ctx.fillText(line, padX + 20, l1Y);
    l1Y += 26;
  }

  // Panel B: Companion Context
  const box2Top = boxTop + p1H + 14;
  const p2H = 158;
  drawRoundedRect(ctx, padX, box2Top, boxW, p2H, 12);
  ctx.fillStyle = 'rgba(16, 16, 20, 0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawRoundedRect(ctx, padX, box2Top, 4, p2H, 2);
  ctx.fillStyle = sec.colorHex;
  ctx.fill();

  ctx.font = '600 12px "Geist Mono", ui-monospace, monospace';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText(
    `${companionTakeaway.label} · ${
      literacy.generatedBy && literacy.generatedBy !== 'DETERMINISTIC'
        ? `${literacy.generatedBy} SYNTHESIS`
        : 'CORTEX INTELLIGENCE'
    }`,
    padX + 20,
    box2Top + 16
  );

  ctx.font =
    companionLevel === 5
      ? '400 15.5px "Geist Mono", ui-monospace, monospace'
      : '400 17px "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#E4E4E7';
  const l5Lines = wrapLines(ctx, companionTakeaway.text, boxW - 40, 4);
  let l5Y = box2Top + 42;
  for (const line of l5Lines) {
    ctx.fillText(line, padX + 20, l5Y);
    l5Y += 25;
  }

  // 5. Footer Watermark + Branded cortex-radar Deep Link
  const footerY = H - 54;
  ctx.beginPath();
  ctx.arc(padX + 6, footerY + 7, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#2DD4BF';
  ctx.fill();

  ctx.font = '700 13px "Geist Mono", ui-monospace, monospace';
  ctx.fillStyle = '#F4F4F5';
  ctx.fillText('cortex-radar · SPATIAL AI INTELLIGENCE', padX + 18, footerY);

  ctx.font = '500 12px "Geist Mono", ui-monospace, monospace';
  ctx.fillStyle = '#71717A';
  const shortDeep = deepLinkUrl.length > 64 ? `${deepLinkUrl.slice(0, 63)}…` : deepLinkUrl;
  const dlWidth = ctx.measureText(shortDeep).width;
  ctx.fillText(shortDeep, W - padX - dlWidth, footerY + 1);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });

  const slug = cleanHeadline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);

  return {
    blob,
    deepLinkUrl,
    filename: `cortex-${slug || 'signal'}.png`,
  };
}
