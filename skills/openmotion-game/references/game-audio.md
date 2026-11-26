> See [source and execution notes](../PROVENANCE.md).

# Game Audio

Every playable game needs responsive SFX **and** a looping BGM bed (unless silence is explicitly requested). Generate music, voice, and signature SFX through live OpenMotion capabilities (`music`, `speech`, `sound-effects`) when usable; synthesize instant UI/micro-SFX (and offline BGM/SFX fallbacks) in Web Audio.

## 1. Live Discovery & Routing

Discover live audio capabilities first (`openmotion_capability_discover` `modality:"audio"`, or `openmotion_media_use` `{"action":"inspect","modality":"audio"}` + `models` `refresh:true` + `reference`), using only live-returned model IDs and options (prefer `account` → `opendesign` → BYOK; check `mode` `"text-to-audio"` vs `"text-to-speech"`, never guess from vendor names):

| Need | Capability / Model (When Live) | Key Rules |
|---|---|---|
| Looping BGM / boss theme | `music` (`elevenlabs-music-v2`) | Prompt mood, tempo, instruments, `instrumental, no vocals`, clean loop ending; use provider-native length option (`duration` on account, `music_length_ms` on Cloud) |
| Signature SFX & ambience loops | `sound-effects` (`elevenlabs-sound-v3`) | Only when active in live discovery; keep prompt concise (`≤ 400 chars`, hard cap `450`); supports `duration_seconds` (`0.5–30`), `loop`, `prompt_influence` (`0–1`). Budget ~3–6 signature clips |
| Voice lines / announcer | `speech` (`elevenlabs-v3`, `byteplus-tts-2`) | Exact spoken line only in prompt; pick `parameters.voice` from live listed voices; reuse one voice per speaker and show subtitles |
| Instant UI/micro-SFX & fallbacks | Web Audio synthesis | Zero-latency procedural SFX (and fallback whenever a live model is unavailable/declined) |

Poll jobs with `action:"status"` until `completed`, never auto-retry failed paid jobs, and wire completed audio by literal `/motion-api/assets/<assetId>/versions/<versionId>/media` URLs via `fetch` + `ctx.decodeAudioData` (with silent fallback to Web Audio on load failure so audio never blocks gameplay).

## 2. Web Audio SFX & BGM Fallback

- **Layered SFX:** Build a compact helper routed to `sfxBus` using filtered noise bursts, resonant sine/triangle envelopes, and `±5%` pitch variation (avoid harsh raw square beeps). Rate-limit rapid stacked impacts.
- **Dynamic coupling:** Couple audio to gameplay state (duck ambience/ordinary hits `-3` to `-6 dB` on critical cues/boss telegraphs, shift intensity or filter cutoff across phases).

## Web Audio BGM fallback

When no live music model is usable or generation is declined, do **not** drop BGM — schedule a lightweight 8–16 bar looping groove on `musicBus` after the first user gesture:

- Use a look-ahead scheduler anchored to `ctx.currentTime` (never raw `setInterval`, which drifts or throttles in background tabs) with 2–3 soft voices (warm bassline, filtered chord pad/pluck, optional subtle pulse).
- Keep `musicBus` around `-18` to `-20 dBFS`, react to danger/phase shifts, and pause/suspend cleanly on mute, `visibilitychange`, end-card, or container pause without stacking duplicate loops on restart.

## 3. Mix, Loudness & Verification

Route `voiceBus` (`-6 dBFS`), `sfxBus` (`-10` to `-12 dBFS`), and `musicBus` (`-18` to `-20 dBFS`, duck ~6 dB under voice) into one master compressor (`true peak <= -3 dBFS`). Loop BGM with `AudioBufferSourceNode.loop` and short fades; never stack raw model outputs at full gain.

- Zero 404s on audio URLs in `openmotion_game_playtest`.
- Unlock/resume `AudioContext` on first user gesture; provide a mute toggle controlling both BGM and SFX; stay playable muted.
- Headless playtest does not verify audible quality — report audio listening as unverified in the final summary.
