import assert from 'node:assert/strict';
import test from 'node:test';
import { exportSubtitleSegments, parseTranscriptSubtitles } from '../shared/transcript.ts';

function vtt(text: string) {
  return `WEBVTT\n\n00:00.000 --> 00:01.000\n${text}\n`;
}

for (const [entity, character] of [['nbsp', '\u00a0'], ['lrm', '\u200e'], ['rlm', '\u200f']] as const) {
  test(`WebVTT imports the defined ${entity} cue escape as its Unicode character`, () => {
    const rows = parseTranscriptSubtitles(vtt(`before&${entity};after`));
    assert.equal(rows[0].text, `before${character}after`);
    assert.equal(rows[0].start, 0);
    assert.equal(rows[0].end, 1);
  });
}

test('mixed cue spans, common escapes, and direction marks retain their text', () => {
  const rows = parseTranscriptSubtitles(vtt('<v Narrator><b>A&amp;B</b>&nbsp;&lt;C&gt; <lang ar>&rlm;مرحبا&lrm;</lang></v>'));
  assert.equal(rows[0].text, 'A&B\u00a0<C> \u200fمرحبا\u200e');
  assert.equal(parseTranscriptSubtitles(exportSubtitleSegments(rows, 'vtt').content)[0].text, rows[0].text);
});

test('escaped ampersands are decoded only once and unknown names remain literal', () => {
  const rows = parseTranscriptSubtitles(vtt('&amp;nbsp; &amp;lrm; &amp;rlm; &notAReference; &NBSP;'));
  assert.equal(rows[0].text, '&nbsp; &lrm; &rlm; &notAReference; &NBSP;');
});

test('SRT retains its existing plain-text entity behavior', () => {
  const rows = parseTranscriptSubtitles('1\n00:00:00,000 --> 00:00:01,000\nbefore&nbsp;after &rlm;\n');
  assert.equal(rows[0].text, 'before&nbsp;after &rlm;');
});
