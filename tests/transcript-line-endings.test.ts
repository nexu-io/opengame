import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSubtitleSegments, parseTranscriptSubtitles } from '../shared/transcript.ts';

const cues = [
  { id: 'segment-1', start: 1.25, end: 2.5, text: 'First line\n第二行' },
  { id: 'segment-2', start: 3, end: 4.125, text: 'Next cue' },
];

for (const format of ['srt', 'vtt'] as const) {
  test(format + ' imports preserve cues and multiline text with CR-only line endings', () => {
    const exported = exportSubtitleSegments(cues, format).content;
    assert.deepEqual(parseTranscriptSubtitles(exported.replace(/\n/g, '\r')), cues);
  });
}

test('BOM and mixed line endings preserve every line of subtitle text', () => {
  for (const format of ['srt', 'vtt'] as const) {
    const separator = format === 'vtt' ? '.' : ',';
    const input = '\uFEFF' + (format === 'vtt' ? 'WEBVTT\r\n\n' : '')
      + '1\r\n00:00:01' + separator + '250 --> 00:00:02' + separator + '500\r\n'
      + 'First line\r第二行\nThird line\r\n\r\n'
      + '2\n00:00:03' + separator + '000 --> 00:00:04' + separator + '125\nNext cue\n';
    assert.deepEqual(parseTranscriptSubtitles(input), [
      { ...cues[0], text: 'First line\n第二行\nThird line' },
      cues[1],
    ]);
  }
});

test('LF and CRLF round trips preserve timestamps and multiline Unicode text', () => {
  for (const format of ['srt', 'vtt'] as const) {
    const exported = exportSubtitleSegments(cues, format).content;
    for (const ending of ['\n', '\r\n']) {
      assert.deepEqual(parseTranscriptSubtitles(exported.replace(/\n/g, ending)), cues);
    }
  }
});

test('line normalization preserves literal SRT text and escaped WebVTT text', () => {
  const literal = [{ id: 'segment-1', start: 0, end: 1, text: 'a < b & c > d\nLiteral <i>text</i> &lt;' }];
  for (const format of ['srt', 'vtt'] as const) {
    const exported = exportSubtitleSegments(literal, format).content;
    assert.deepEqual(parseTranscriptSubtitles(exported.replace(/\n/g, '\r\n')), literal);
  }
});

test('invalid timestamps remain invalid with LF, CRLF and CR line endings', () => {
  const invalid = '1\n00:61:00,000 --> 01:02:00,000\nInvalid\n';
  for (const ending of ['\n', '\r\n', '\r']) {
    assert.throws(() => parseTranscriptSubtitles(invalid.replace(/\n/g, ending)), /Invalid subtitle (?:cue|timestamp)/);
  }
});
