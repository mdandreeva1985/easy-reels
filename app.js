// Заголовки для Reels: накладывает заголовок (белая плашка, чёрный текст) на видео.
// Вся обработка идёт прямо на устройстве, ролики никуда не отправляются.
import {
  Input, ALL_FORMATS, BlobSource, Output, BufferTarget, Mp4OutputFormat,
  CanvasSource, AudioBufferSource, CanvasSink, AudioBufferSink,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';

export const W = 1080, H = 1920;           // формат Reels
export const MAX_SEC = 90;                          // длиннее 90 секунд не берём
const FONT = '700 {px}px -apple-system, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// ---------------------------------------------------------------------------
// Заголовки: из вставленного текста достаём пронумерованные строки
// ---------------------------------------------------------------------------
export function parseTitles(text) {
  const src = String(text || '').replace(/\r/g, '');
  // формат PDF: «Заголовок: …»
  const labeled = [...src.matchAll(/^\s*(?:заголовок|хук)\s*[:—-]\s*(.+)$/gim)].map((m) => m[1].trim());
  if (labeled.length) return labeled.map(clean).filter(Boolean).slice(0, 30);
  // формат «1. текст» / «1) текст»
  const numbered = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\s*[.)]\s*(.+)$/);
    if (m) numbered.push(clean(m[2]));
  }
  if (numbered.length) return numbered.filter(Boolean).slice(0, 30);
  // просто строки
  return src.split('\n').map(clean).filter((l) => l && !/^(скопируй|заголовки для|```)/i.test(l)).slice(0, 30);
}
function clean(s) {
  return s.replace(/^[«"“']+|[»"”']+$/g, '').replace(/^\[|\]$/g, '').replace(/\*\*/g, '').trim();
}

// ---------------------------------------------------------------------------
// Плашка с заголовком: прозрачный слой 1080×1920
// ---------------------------------------------------------------------------
// Позиция плашки: доля высоты кадра, где стоит СЕРЕДИНА плашки (0 — верх, 1 — низ)
export const POS = { top: 0.22, center: 0.5, bottom: 0.72, default: 0.5 };
const SAFE_TOP = 0.04, SAFE_BOTTOM = 0.96;   // плашка не уходит за края кадра

// Плашка: картинка шириной 1080 и высотой ровно по тексту
export function makePlate(title) {
  const tmp = document.createElement('canvas').getContext('2d');
  let size = 66;
  const maxW = 900;
  let lines;
  // если заголовок длинный — уменьшаем шрифт, чтобы было не больше 5 строк
  for (;;) {
    tmp.font = FONT.replace('{px}', size);
    lines = wrap(tmp, title, maxW);
    if (lines.length <= 5 || size <= 44) break;
    size -= 4;
  }
  const lineH = Math.round(size * 1.28);
  const padX = Math.round(size * 0.42), padY = Math.round(size * 0.16);
  const r = Math.round(size * 0.32);
  const c = document.createElement('canvas');
  c.width = W; c.height = lines.length * lineH + padY * 2;
  const ctx = c.getContext('2d');
  ctx.font = FONT.replace('{px}', size);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  lines.forEach((ln, i) => {
    const w = ctx.measureText(ln).width;
    roundRect(ctx, (W - w) / 2 - padX, padY + i * lineH - padY, w + padX * 2, lineH + padY * 2, r);
  });
  ctx.fillStyle = '#000000';
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, padY + i * lineH + lineH / 2));
  return c;
}
// верхний край плашки (в пикселях кадра 1080×1920) для позиции pos
export function plateTop(plate, pos) {
  const y = Math.round((pos ?? POS.default) * H - plate.height / 2);
  return Math.max(Math.round(SAFE_TOP * H), Math.min(Math.round(SAFE_BOTTOM * H) - plate.height, y));
}
// позиция по точке касания (доля высоты), с учётом краёв
export function clampPos(plate, pos) {
  return (plateTop(plate, pos) + plate.height / 2) / H;
}
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + word : word;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [''];
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

// Кадр «как у Reels»: заполняем 1080×1920 без чёрных полос (лишнее по краям обрезаем)
function drawCover(ctx, img, sw, sh) {
  const k = Math.max(W / sw, H / sh);
  const dw = sw * k, dh = sh * k;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// ---------------------------------------------------------------------------
// Превью: первый кадр видео + плашка (маленькая картинка для списка)
// ---------------------------------------------------------------------------
export async function previewFrame(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const dur = await input.computeDuration();
    const sw = track.displayWidth, sh = track.displayHeight;
    const k = 360 / Math.min(sw, sh);
    const wc = await new CanvasSink(track, { width: Math.round(sw * k), height: Math.round(sh * k), fit: 'fill' })
      .getCanvas(Math.min(0.5, dur / 2));
    return wc ? { canvas: wc.canvas, duration: dur } : null;
  } finally {
    input.dispose?.();
  }
}
// Ролик для окна правки: длительность, кадр в любой момент, лента кадров для обрезки
export async function openClip(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) { input.dispose?.(); return null; }
  const duration = await input.computeDuration();
  const sw = track.displayWidth, sh = track.displayHeight;
  const k = 360 / Math.min(sw, sh);
  const sink = new CanvasSink(track, { width: Math.round(sw * k), height: Math.round(sh * k), fit: 'fill' });
  const small = new CanvasSink(track, { width: Math.round(sw * k / 4), height: Math.round(sh * k / 4), fit: 'fill' });
  return {
    duration,
    frameAt: async (s) => (await sink.getCanvas(Math.max(0, Math.min(duration - 0.05, s))))?.canvas || null,
    async strip(n) {
      const ts = Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n);
      const out = [];
      for await (const wc of small.canvasesAtTimestamps(ts)) out.push(wc?.canvas || null);
      return out;
    },
    close: () => input.dispose?.(),
  };
}

export function drawPreview(canvas, frame, plate, pos) {
  const s = canvas.width / W;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
  if (frame) drawCover(ctx, frame, frame.width, frame.height);
  if (plate) ctx.drawImage(plate, 0, plateTop(plate, pos));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Звук без изменений (перекодируем в AAC)
// ---------------------------------------------------------------------------
async function readAudio(track, t0, t1) {
  const parts = [];
  let sr = track.sampleRate, ch = Math.min(2, track.numberOfChannels || 2);
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(t0, t1)) {
    sr = buffer.sampleRate; ch = Math.min(2, buffer.numberOfChannels);
    parts.push({ buffer, timestamp });
  }
  if (!parts.length) return null;
  const len = Math.max(1, Math.round((t1 - t0) * sr));
  const ctx = new OfflineAudioContext(ch, len, sr);
  const out = ctx.createBuffer(ch, len, sr);
  for (const { buffer, timestamp } of parts) {
    const off = Math.round((timestamp - t0) * sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const from = Math.max(0, -off), to = Math.min(src.length, len - off);
      if (to > from) out.getChannelData(c).set(src.subarray(from, to), off + from);
    }
  }
  return out;
}

let aacReady = null;
function ensureAac() {
  if (!aacReady) {
    aacReady = (async () => {
      if (!(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('./vendor/mediabunny-aac-encoder.min.mjs');
        registerAacEncoder();
      }
    })();
  }
  return aacReady;
}

// ---------------------------------------------------------------------------
// Один рилс: видео + заголовок → mp4 1080×1920
// opts: { pos, start, end, signal, software, created } — позиция плашки, обрезка (сек), отмена, программный кодировщик, дата создания
// ---------------------------------------------------------------------------
export async function makeReel(file, title, onProgress = () => {}, opts = {}) {
  const check = () => { if (opts.signal?.aborted) throw new DOMException('Отменено', 'AbortError'); };
  check();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) throw new Error('В файле нет видео');
    const aTrack = await input.getPrimaryAudioTrack();
    const full = await input.computeDuration();
    const t0 = Math.max(0, Math.min(full - 0.1, opts.start || 0));
    const t1 = Math.min(full, t0 + MAX_SEC, opts.end > t0 ? opts.end : full);
    const duration = t1 - t0;

    let srcFps = 30;
    try { srcFps = (await vTrack.computePacketStats(200)).averagePacketRate || 30; } catch {}
    const fps = [24, 25, 30].reduce((a, b) => (Math.abs(b - srcFps) < Math.abs(a - srcFps) ? b : a));
    const bitrate = 9e6;
    const hw = opts.software ? { hardwareAcceleration: 'prefer-software' } : {};
    if (!(await canEncodeVideo('avc', { width: W, height: H, bitrate, ...hw }))) {
      throw new Error('Это устройство не умеет кодировать видео 1080×1920');
    }

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    const plate = makePlate(title);
    const plateY = plateTop(plate, opts.pos);

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const vSource = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2, latencyMode: 'quality', ...hw });
    output.addVideoTrack(vSource);

    let aSource = null, audio = null;
    if (aTrack && (await aTrack.canDecode())) {
      await ensureAac();
      audio = await readAudio(aTrack, t0, t1);
      if (audio) {
        aSource = new AudioBufferSource({ codec: 'aac', bitrate: 160000 });
        output.addAudioTrack(aSource);
      }
    }
    // дата создания по порядку (рилс 1 раньше рилса 2) — в галерее они встанут подряд
    output.setMetadataTags({ creationTime: opts.created || new Date() });
    await output.start();
    if (aSource) { await aSource.add(audio); aSource.close(); }

    const sw = vTrack.displayWidth, sh = vTrack.displayHeight;
    const k = Math.max(W / sw, H / sh);
    const sink = new CanvasSink(vTrack, { width: Math.round(sw * k), height: Math.round(sh * k), fit: 'fill', poolSize: 2 });
    const frameCount = Math.max(1, Math.floor(duration * fps));
    function* times() { for (let j = 0; j < frameCount; j++) yield t0 + Math.min(duration - 0.001, j / fps); }
    let fi = 0;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    try {
      for await (const wc of sink.canvasesAtTimestamps(times())) {
        check();
        if (wc) {
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          drawCover(ctx, wc.canvas, wc.canvas.width, wc.canvas.height);
          ctx.drawImage(plate, 0, plateY);
        }
        await vSource.add(fi / fps, 1 / fps);
        fi++;
        if (fi % 10 === 0) onProgress(fi / frameCount);
      }
    } catch (e) {
      await output.cancel().catch(() => {});
      throw e;
    }
    vSource.close();
    await output.finalize();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose?.();
  }
}
