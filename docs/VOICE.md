# Voice feed

Voice turns typed test phrases into wake matches and queued runs. There is no mic source yet. Type one phrase on the test device and paste it as text.

## Transcript shape

Parse every phrase with parseVoiceTranscript first. It returns ok true plus transcript or ok false plus reason.

- text holds the spoken phrase trimmed. Blank text fails with empty text. Long text fails past 2000 chars.
- deviceId holds the test device id or null. It defaults to null.
- at holds the unix time in ms. It defaults to now.
- lang holds the language tag. It defaults to en.

```js
const voice = require("../src/voice");
const parsed = voice.parseVoiceTranscript({ text: "zot build the report", deviceId: "dev1" });
```

## Wake match

Use matchWakeWord for a pure check. It keeps no state. Use onTranscript when the hit count should grow. Use ingestVoiceTranscript for the full feed. It parses once then matches then builds run input on a hit and null on a miss.

```js
voice.matchWakeWord("Hey zot run this", "zot");
voice.onTranscript("Hey zot run this", "zot");
const fed = voice.ingestVoiceTranscript("Hey zot run this", { wakeWord: "zot" });
```

## Run wiring

Use commandFromTranscript to strip the wake word from the prompt. Use toVoiceRunInput to build title plus prompt plus ownerDeviceId. Pass that object straight into runs.createRun.

```js
const runs = require("../src/runs");
const fed = voice.ingestVoiceTranscript("zot build the report", { wakeWord: "zot" });
if (fed.hit) {
  const run = runs.createRun({
    id: "voice-run-1",
    title: fed.runInput.title,
    prompt: fed.runInput.prompt,
    ownerDeviceId: fed.runInput.ownerDeviceId,
  });
}
```

## Route

Send typed phrases to the API route below.

```sh
curl -X POST http://127.0.0.1:8787/api/v1/voice/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"zot build the report","deviceId":"dev1"}'
```

Behavior follows this list.

- Auth uses Bearer device token. Missing or bad token returns 401.
- Rate limit allows 30 requests per minute per handler. Burst traffic returns 429.
- Body holds text plus optional deviceId plus at plus lang. Bad input returns 400 with reason.
- Wake miss returns 200 with hit false plus transcript. It creates no run.
- Wake hit strips the wake word then creates a run in queued state. It returns 201 with hit true plus transcript plus run.
- Owner uses body deviceId when present. It falls back to the auth session id when missing.
- Runner queue picks up the queued run on its next poll. No extra queue step is needed.

## Mic stub

No mic is wired. MIC_NOTE in src voice.js says the same. Type one phrase on the test device and paste it as text. Add the real mic source later behind the same transcript shape.

## Check

Run the commands below from the repo root.

```sh
node --check src/voice.js
node --check src/api.js
node scripts/verify-voice.js
grep -n "voice" src/api.js
```
