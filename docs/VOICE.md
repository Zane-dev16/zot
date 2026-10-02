# Voice feed

Voice turns typed test phrases into wake matches and run inputs. There is no mic source yet. There is no route yet. The caller wires the helpers below.

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

## Mic stub

No mic is wired. MIC_NOTE in src voice.js says the same. Type one phrase on the test device and paste it as text. Add the real mic source later behind the same transcript shape.

## Check

Run the two commands below from the repo root.

```sh
node --check src/voice.js
node scripts/verify-voice.js
```
