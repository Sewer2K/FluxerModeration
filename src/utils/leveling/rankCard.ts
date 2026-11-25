import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { join } from 'path';
import { existsSync } from 'fs';
import type { IRankCardSettings, ILevelingFormula } from '@/types/Leveling';
import { DEFAULT_LEVELING } from '@/types/Leveling';
import { xpForLevel, totalXpForLevel } from './formula';

const WIDTH = 800;
const HEIGHT = 220;
const AVATAR_SIZE = 116;
const AVATAR_PAD = 28;
const AVATAR_X = AVATAR_PAD + AVATAR_SIZE / 2;
const AVATAR_Y = 96;
const AVATAR_RADIUS = AVATAR_SIZE / 2;
const TEXT_X = AVATAR_PAD + AVATAR_SIZE + 32;
const BAR_Y = 182;
const BAR_H = 16;
const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const DEFAULT_AVATAR = join(__dirname, '..', '..', 'assets', 'default-avatar.png');
const FONT_FAMILY = 'RankCardFont';
let fontReady = false;

async function ensureFont(): Promise<void> {
  if (fontReady) return;

  const dest = join(FONTS_DIR, 'Poppins-Bold.ttf');
  if (existsSync(dest)) {
    GlobalFonts.registerFromPath(dest, FONT_FAMILY);
  } else {
    console.warn('[rankCard] Poppins-Bold.ttf not found, text may not render');
  }

  fontReady = true;
}

function canvasFont(size: number, weight = 'bold'): string {
  const family = GlobalFonts.families.some((f) => f.family === FONT_FAMILY) ? FONT_FAMILY : 'sans-serif';
  return `${weight} ${size}px "${family}"`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function drawAvatar(
  ctx: SKRSContext2D,
  avatarURL: string | null | undefined,
  username: string,
  accent: { r: number; g: number; b: number },
  font: { r: number; g: number; b: number },
): Promise<void> {
  const resolved = avatarURL || (existsSync(DEFAULT_AVATAR) ? DEFAULT_AVATAR : null);

  let avatar: Image | null;
  try {
    avatar = resolved ? await loadImage(resolved) : null;
  } catch {
    avatar = null;
  }

  ctx.strokeStyle = `rgb(${accent.r},${accent.g},${accent.b})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_RADIUS + 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_RADIUS, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (avatar) {
    ctx.drawImage(avatar, AVATAR_X - AVATAR_RADIUS, AVATAR_Y - AVATAR_RADIUS, AVATAR_SIZE, AVATAR_SIZE);
  } else {
    ctx.fillStyle = '#3a3a5c';
    ctx.fillRect(AVATAR_X - AVATAR_RADIUS, AVATAR_Y - AVATAR_RADIUS, AVATAR_SIZE, AVATAR_SIZE);
    ctx.fillStyle = `rgb(${font.r},${font.g},${font.b})`;
    ctx.font = canvasFont(44);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(username.charAt(0).toUpperCase(), AVATAR_X, AVATAR_Y);
  }

  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export interface RankCardInput {
  username: string;
  avatarURL?: string | null;
  level: number;
  xp: number;
  rank: number | null;
  formula?: ILevelingFormula;
  settings?: IRankCardSettings;
}

export async function generateRankCard(input: RankCardInput): Promise<Buffer> {
  await ensureFont();

  const card = { ...DEFAULT_LEVELING.rankCard, ...(input.settings ?? {}) };
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.globalAlpha = Math.max(0, Math.min(1, (card.opacity ?? 100) / 100));

  const bg = hexToRgb(card.backgroundColor);
  ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const accent = hexToRgb(card.progressColor);
  ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},0.35)`;
  ctx.beginPath();
  ctx.moveTo(WIDTH * 0.55, 0);
  ctx.lineTo(WIDTH, 0);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(WIDTH * 0.35, HEIGHT);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;
  const font = hexToRgb(card.fontColor);
  await drawAvatar(ctx, input.avatarURL, input.username, accent, font);

  ctx.fillStyle = `rgb(${font.r},${font.g},${font.b})`;
  ctx.font = canvasFont(36);
  ctx.fillText(input.username.slice(0, 28), TEXT_X, 76);

  ctx.font = canvasFont(22, 'normal');
  const formula = input.formula ?? DEFAULT_LEVELING.formula;
  const into = Math.max(0, input.xp - totalXpForLevel(input.level, formula));
  const needed = xpForLevel(input.level, formula);
  ctx.fillText(`Level: ${input.level}`, TEXT_X, 122);
  ctx.fillText(`XP: ${into} / ${needed}`, TEXT_X + 176, 122);
  ctx.fillText(`Rank: ${input.rank ?? '—'}`, TEXT_X + 420, 122);

  const barX = TEXT_X;
  const barW = WIDTH - barX - AVATAR_PAD;
  const pct = needed > 0 ? Math.min(1, into / needed) : 0;

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(barX, BAR_Y, barW, BAR_H);
  ctx.fillStyle = `rgb(${accent.r},${accent.g},${accent.b})`;
  ctx.fillRect(barX, BAR_Y, barW * pct, BAR_H);

  return canvas.encode('png') as unknown as Buffer;
}
