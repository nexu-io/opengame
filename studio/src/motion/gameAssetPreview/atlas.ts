type Rect = { x: number; y: number; w: number; h: number };
export type SpriteFrame = { name: string; crop: Rect; offsetX: number; offsetY: number; width: number; height: number; rotated: boolean };

function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 32768) throw new Error('Invalid atlas dimensions');
  return value;
}

export function parseAtlas(text: string) {
  const atlas = JSON.parse(text);
  if (!atlas?.frames || typeof atlas.frames !== 'object' || typeof atlas.meta?.image !== 'string') throw new Error('Invalid atlas');
  const entries = Object.entries(atlas.frames);
  if (!entries.length || entries.length > 16384) throw new Error('Invalid frame count');
  const frames: SpriteFrame[] = entries.map(([key, raw]) => {
    const item = raw as {filename?: string; frame: Rect; rotated?: boolean; spriteSourceSize?: Rect; sourceSize?: Pick<Rect,'w'|'h'>};
    const crop = { x: integer(item.frame.x, 0), y: integer(item.frame.y, 0), w: integer(item.frame.w, 1), h: integer(item.frame.h, 1) };
    const rotated = item.rotated === true;
    const trimmed = item.spriteSourceSize;
    // Pixi exports may describe a rotated rectangle in its upright dimensions.
    if (rotated && trimmed?.w === crop.w && trimmed?.h === crop.h) [crop.w, crop.h] = [crop.h, crop.w];
    const offsetX = integer(trimmed?.x ?? 0, 0);
    const offsetY = integer(trimmed?.y ?? 0, 0);
    const w = rotated ? crop.h : crop.w;
    const h = rotated ? crop.w : crop.h;
    const width = integer(item.sourceSize?.w ?? w, 1);
    const height = integer(item.sourceSize?.h ?? h, 1);
    if (offsetX + w > width || offsetY + h > height) throw new Error('Invalid trim');
    const name = Array.isArray(atlas.frames) && typeof item.filename === 'string' ? item.filename : key;
    return { name, crop, rotated, width, height, offsetX, offsetY };
  });
  const actions = atlas.animations;
  if (actions !== undefined && (!actions || typeof actions !== 'object' || Array.isArray(actions))) throw new Error('Invalid atlas animations');
  const byName = new Map(frames.map(frame => [frame.name, frame]));
  const animations = Object.entries(actions ?? {}).map(([name, sequence]) => {
    if (!Array.isArray(sequence) || !sequence.length) throw new Error('Invalid animation sequence');
    const ordered = sequence.map(reference => {
      const frame = byName.get(reference);
      if (!frame) throw new Error('Unknown animation frame');
      return frame;
    });
    return { name, frames: ordered };
  });
  return { image: atlas.meta.image as string, frames, animations };
}

export function gridFrame(width: number, height: number, rows: number, cols: number, index: number): SpriteFrame {
  const col = index % cols, row = Math.floor(index / cols);
  const x = Math.floor(col * width / cols), y = Math.floor(row * height / rows);
  const w = Math.floor((col + 1) * width / cols) - x, h = Math.floor((row + 1) * height / rows) - y;
  return { name: '', crop: { x, y, w, h }, width: w, height: h, offsetX: 0, offsetY: 0, rotated: false };
}

export function drawFrame(canvas: HTMLCanvasElement, image: HTMLImageElement, frame: SpriteFrame) {
  const scale = Math.min(1, 1536 / Math.max(frame.width, frame.height));
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { x, y, w, h } = frame.crop;
  ctx.scale(canvas.width / frame.width, canvas.height / frame.height);
  ctx.imageSmoothingEnabled = false;
  ctx.translate(frame.offsetX, frame.offsetY + (frame.rotated ? w : 0));
  if (frame.rotated) ctx.rotate(-Math.PI / 2);
  ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
}
