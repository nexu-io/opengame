import { afterEach, describe, expect, it, vi } from 'vitest';
import { companionPath, detectGameAssetPreview, readPreviewBytes } from './formats';
import { gridFrame, parseAtlas } from './atlas';
import { disposeModel, loadInterchange } from './loadInterchange';

afterEach(() => vi.unstubAllGlobals());

describe('workspace game asset previews', () => {
  it('resolves local subfolders and siblings within the workspace', () => {
    expect(companionPath('model/unit/hero.gltf', '../textures/a%20b.png')).toBe('model/textures/a b.png');
    for (const ref of ['../../escape', '/etc/passwd', '//example.org/img', 'file:///tmp/img', 'C:\\images\\a', 'https://example.org/img', '%2fescape', '%252e%252e/file', 'a%00b']) {
      expect(() => companionPath('model/a.gltf', ref)).toThrow();
    }
  });

  it('keeps ordinary JSON in its original viewer', () => {
    expect(detectGameAssetPreview('save.json', '{"level": 1}')).toBeNull();
    expect(detectGameAssetPreview('hero.json', '{"frames":[],"meta":{"image":"hero.png"}}')).toBe('atlas');
    expect(detectGameAssetPreview('level.tmj')).toBe('tilemap');
    expect(detectGameAssetPreview('level.json', '{"type":"map","layers":[],"tilesets":[]}')).toBe('tilemap');
  });

  it('reads hash and array atlases with restored offsets and clockwise rotations', () => {
    const item = { filename: 'run', frame: { x: 1, y: 2, w: 3, h: 2 }, rotated: true, spriteSourceSize: { x: 2, y: 1, w: 2, h: 3 }, sourceSize: { w: 5, h: 6 } };
    for (const frames of [[item], { run: item }]) {
      expect(parseAtlas(JSON.stringify({ meta: { image: 'a.png' }, frames })).frames).toEqual([{ name: 'run', crop: item.frame, rotated: true, offsetX: 2, offsetY: 1, width: 5, height: 6 }]);
    }
    expect(gridFrame(5, 4, 2, 2, 3).crop).toEqual({ x: 2, y: 2, w: 3, h: 2 });
  });

  it('preserves authored animation order, subsets and repeated frame references', () => {
    const frame = { frame: { x: 0, y: 0, w: 1, h: 1 } };
    const manifest = { frames: { a: frame, b: frame, c: frame }, meta: { image: 'sheet.png' } };
    const parse = (animations?: Record<string, string[]>) => parseAtlas(JSON.stringify({ ...manifest, animations }));
    const { animations, frames } = parse({ Walk: ['b', 'a', 'b'], Idle: ['c'] });
    expect(animations.map(({ name, frames }) => [name, frames.map(frame => frame.name)])).toEqual([['Walk', ['b', 'a', 'b']], ['Idle', ['c']]]);
    expect(animations[0].frames[2]).toBe(frames[1]);
    expect(() => parse({ Walk: ['b', 'unknown'] })).toThrow('Unknown animation frame');
    expect(parse().animations).toEqual([]);
    expect(parse().frames.map(frame => frame.name)).toEqual(['a', 'b', 'c']);
  });

  it('bounds streaming reads without requiring a Content-Length', async () => {
    vi.stubGlobal('fetch', async () => new Response('large payload'));
    await expect(readPreviewBytes('/file', new AbortController().signal, 4)).rejects.toThrow('File too large');
  });

  it('stops a glTF with missing or out-of-workspace resources before parsing the model', async () => {
    for (const uri of ['https://example.org/a.bin', '../outside.bin', 'missing.bin']) {
      const asset = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri, byteLength: 4 }] });
      const fetch = vi.fn(async (url: string) => url === '/source' ? new Response(asset) : new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetch);
      const resolveFileUrl = vi.fn(() => '/approved');
      await expect(loadInterchange({ path: 'hero.gltf', url: '/source', resolveFileUrl }, new AbortController().signal)).rejects.toThrow();
      expect(resolveFileUrl).toHaveBeenCalledTimes(uri === 'missing.bin' ? 1 : 0);
      expect(fetch.mock.calls.map(call => call[0])).toEqual(uri === 'missing.bin' ? ['/source', '/approved'] : ['/source']);
    }
  });

  const samples = {
    fbx: '; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n\tFBXVersion: 7400\n}\nObjects:  {\n\tGeometry: 1, "Geometry::Triangle", "Mesh" {\n\t\tVertices: *9 {\n\t\t\ta: 0,0,0,1,0,0,0,1,0\n\t\t}\n\t\tPolygonVertexIndex: *3 {\n\t\t\ta: 0,1,-3\n\t\t}\n\t}\n\tModel: 2, "Model::Triangle", "Mesh" {\n\t\tVersion: 232\n\t}\n}\nConnections:  {\n\tC: "OO",1,2\n\tC: "OO",2,0\n}\n',
    obj: 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n',
    stl: 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle',
    ply: 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
    bvh: 'HIERARCHY\nROOT Hip\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\nEnd Site\n{\nOFFSET 0 1 0\n}\n}\nMOTION\nFrames: 2\nFrame Time: 0.03333\n0 0 0 0 0 0\n0 0 0 30 0 0\n',
  };
  it.each(Object.entries(samples))('decodes real %s geometry or bones', async (ext, source) => {
    vi.stubGlobal('fetch', async () => new Response(source));
    const { root } = await loadInterchange({ path: `hero.${ext}`, url: '/file' }, new AbortController().signal);
    if (ext === 'bvh') {
      const hip = root.getObjectByName('Hip');
      expect(hip?.isBone).toBe(true);
      expect(hip.children[0].isBone).toBe(true);
      expect(root.animations[0].duration).toBeGreaterThan(0);
    } else {
      let vertices = 0;
      root.traverse((object: { geometry?: { attributes: { position: { count: number } } } }) => { vertices += object.geometry?.attributes.position.count || 0; });
      expect(vertices).toBeGreaterThan(0);
    }
    disposeModel(root);
  });
});
