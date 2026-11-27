import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSingleByteRange } from '../shared/http-header.ts';

test('single byte ranges resolve bounded, open-ended and suffix intervals', () => {
  for (const [header, start, end] of [
    ['bytes=2-5', 2, 5], ['bytes=4-', 4, 15], ['bytes=-4', 12, 15],
    ['bytes=0-99', 0, 15], ['bytes=-99', 0, 15], ['bytes=15-15', 15, 15],
    ['bytes=2-99999999999999999999', 2, 15], ['bytes=-99999999999999999999', 0, 15],
  ] as const) assert.deepEqual(parseSingleByteRange(header, 16), { start, end }, header);
});

test('single byte ranges reject malformed and unsatisfiable intervals', () => {
  for (const header of ['bytes=-', 'bytes=-0', 'bytes=16-', 'bytes=9-2', 'bytes=1.5-2',
    'bytes=0-1,4-5', 'items=0-1', 'bytes=99999999999999999999-', 'BYTES=0-1', 'bytes= 0-1']) {
    assert.equal(parseSingleByteRange(header, 16), null, header);
  }
  assert.equal(parseSingleByteRange('bytes=0-', 0), null);
});
