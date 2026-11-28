import test from 'node:test';
import assert from 'node:assert/strict';
import { portableNameProblem } from '../shared/project-name.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { zip } from '../scripts/zip.mjs';

test('portable project paths continue rejecting existing reserved and trailing-dot names', () => {
  for (const segment of ['con.html', 'AUX.png', 'NUL', 'COM1.js', 'lpt9.txt', 'notes.', 'notes ']) {
    const name = `assets/${segment}`;
    assert.equal(portableNameProblem(name), segment, name);
    assert.throws(() => readProjectZip(zip([{ name, data: Buffer.from('content') }])), /INVALID_PROJECT_ARCHIVE/, name);
  }
});

test('portable project paths reject Windows filename metacharacters in every segment', () => {
  for (const character of ['<', '>', '"', '|', '?', '*']) {
    const segment = `sprite${character}1.png`;
    for (const name of [`assets/${segment}`, `${segment}/index.html`]) {
      assert.equal(portableNameProblem(name), segment, name);
      assert.throws(() => readProjectZip(zip([{ name, data: Buffer.from('content') }])), /INVALID_PROJECT_ARCHIVE/, name);
    }
  }
});

test('portable project paths reject superscript Windows device names with or without extensions', () => {
  for (const base of ['COM', 'LPT', 'com', 'lpt']) {
    for (const digit of ['¹', '²', '³']) {
      for (const suffix of ['', '.txt', '.tar.gz']) {
        const segment = `${base}${digit}${suffix}`, name = `assets/${segment}`;
        assert.equal(portableNameProblem(name), segment, name);
        assert.throws(() => readProjectZip(zip([{ name, data: Buffer.from('content') }])), /INVALID_PROJECT_ARCHIVE/, name);
      }
    }
  }
});

test('portable project paths preserve supported punctuation and non-device Unicode names', () => {
  const names = ['assets/Scene (1)+2.png', 'assets/字幕.png', 'scripts/COM10.js', 'audio/LPT0.wav', 'assets/COM¹-preview.png', 'assets/COM⁴.txt'];
  const entries = names.map(name => ({ name, data: Buffer.from(name) }));
  for (const name of names) assert.equal(portableNameProblem(name), null, name);
  assert.deepEqual([...readProjectZip(zip(entries))], entries.map(({ name, data }) => [name, data]));
});
