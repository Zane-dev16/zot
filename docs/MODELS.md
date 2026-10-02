# Models

Router serves echo by default. No key is needed offline.

One live provider is available. It uses OpenAI chat completions through fetch with timeout.

Setup needs one env var.

```
OPENAI_API_KEY=... node src/daemon2.js
```

Optional vars tune behavior.

```
ZOT_OPENAI_MODEL=gpt-4o-mini
ZOT_MODEL_TIMEOUT_MS=15000
```

Without a key the live model falls back to echo. The reply keeps the live model id. The text uses echo shape. Eval stays green offline.

Keys live only in env. Never commit a key. Docs name vars only.

Verify with these commands.

```
node --check src/router.js
OPENAI_API_KEY= node scripts/verify-router.js
npm run eval
```

Behavior notes follow.

```
router.exec stays sync echo
router.execAsync uses live provider when key is set
router.isLiveConfigured reports key presence
every exec logs model id
```
