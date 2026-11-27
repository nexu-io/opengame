import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../scripts/zip.mjs';
import { readProjectZip } from '../shared/project-zip.ts';

test('stored ZIP bytes retain their deterministic headers and standard CRC-32', () => {
  const result = zip([{ name: 'hello.txt', data: Buffer.from('123456789') }]);
  const expected = Buffer.from(
    '504b0304140000080000000021002639f4cb09000000090000000900000068656c6c6f2e747874313233343536373839'
    + '504b01021400140000080000000021002639f4cb090000000900000009000000000000000000000000000000000068656c6c6f2e747874'
    + '504b0506000000000100010037000000300000000000',
    'hex',
  );
  assert.deepEqual(result, expected);
});

test('stored ZIPs round trip binary, UTF-8 and empty project files', () => {
  const entries = [
    { name: 'assets/场景.bin', data: Buffer.from(Array.from({ length: 256 }, (_, byte) => byte)) },
    { name: 'index.html', data: Buffer.from('<p>Scene café</p>') },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  assert.deepEqual([...readProjectZip(zip(entries))], entries.map(({ name, data }) => [name, data]));
});

test('an empty ZIP has only its end-of-central-directory record', () => {
  assert.deepEqual(zip([]), Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
});
