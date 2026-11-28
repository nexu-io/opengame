// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../../../../browser';
import type { renderTiledMap } from './TiledMap';

it('renders every orthogonal flip and reports missing companions and unsupported exports', async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./TiledMap.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'tiled' });
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate(bundle.outputFiles[0].text);
    const result = await page.evaluate(async () => {
      const { renderTiledMap: render } = (window as unknown as { tiled: { renderTiledMap: typeof renderTiledMap } }).tiled;
      const image = document.createElement('canvas');
      image.width = image.height = 2;
      const ctx = image.getContext('2d')!;
      for (const [i, shade] of [16, 32, 48, 64].entries()) {
        ctx.fillStyle = `rgb(${shade},0,0)`;
        ctx.fillRect(i % 2, Math.floor(i / 2), 1, 1);
      }
      const json = (value: unknown) => URL.createObjectURL(new Blob([JSON.stringify(value)]));
      const atlas = json({ image: '../art/a.png', tilewidth: 2, tileheight: 2, columns: 1, tilecount: 1 });
      const files: Record<string, string> = { 'sets/s.tsj': atlas, 'art/a.png': image.toDataURL() };
      const layer = { type: 'tilelayer', width: 8, height: 1, data: Array.from({ length: 8 }, (_, index) => index * 0x20000000 + 1) };
      const map = { type: 'map', orientation: 'orthogonal', width: 8, height: 1, tilewidth: 2, tileheight: 2, tilesets: [{ firstgid: 1, source: '../sets/s.tsj' }], layers: [layer] };
      const preview = (doc: unknown) => render({ path: 'maps/m.tmj', url: json(doc), resolveFileUrl: path => files[path] }, new AbortController().signal);
      const canvas = await preview(map);
      const data = canvas.getContext('2d')!.getImageData(0, 0, 16, 2).data;
      const tiles = Array.from({ length: 8 }, (_, n) => [0, 1, 16, 17].map(offset => data[(n * 2 + offset) * 4] / 16).join(''));
      const top = { ...layer, data: [0, 1, 0, 0, 0, 0, 0, 0] };
      const overlay = await preview({ ...map, layers: [layer, top] });
      const topRight = overlay.getContext('2d')!.getImageData(3, 0, 1, 1).data[0];
      const reason = async (doc: unknown) => { try { await preview(doc); return ''; } catch (err) { return (err as Error).message; } };
      const encoding = await reason({ ...map, layers: [layer, { ...layer, data: 'AAAA', encoding: 'base64' }] });
      const projection = await reason({ ...map, orientation: 'isometric' });
      delete files['art/a.png'];
      return { tiles, topRight, encoding, projection, missing: await reason(map) };
    });
    expect(result.tiles).toEqual(['1234', '1324', '3412', '2413', '2143', '3142', '4321', '4231']);
    expect(result.topRight).toBe(32);
    expect(result.missing).toBe('art/a.png');
    expect(result.encoding).toMatch(/JSON tile arrays/);
    expect(result.projection).toMatch(/orthogonal/);
  } finally { await browser.close(); }
}, 60_000);
