# Models

Router serves echo by default. No key is needed offline.

Two live providers are available. Each uses fetch with timeout. Keys live only in env. Never commit a key. Docs name vars only.

```
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... node src/daemon2.js
```

Optional vars tune behavior.

```
ZOT_OPENAI_MODEL=gpt-4o-mini
ZOT_ANTHROPIC_MODEL=claude-3-5-haiku-latest
ZOT_MODEL_TIMEOUT_MS=15000
```

Fallback order tries the requested live model first. Then it tries the other live model with a key. Dead or keyless providers are skipped. With no key at all the live model falls back to echo. The reply keeps the requested model id in that case. With a dead primary and a live second the reply carries the second model id. Eval stays green offline.

Verify with these commands.

```
node --check src/router.js
OPENAI_API_KEY= node scripts/verify-router.js
node scripts/verify-approvals.js
npm run eval
```

Behavior notes follow.

```
router.exec stays sync echo
router.execAsync tries fallback order then echo
router.fallbackOrder names the try order
router.providerKeyEnv names the env var per provider
router.isLiveConfigured reports key presence per provider
tool deny uses deny prefix in tool_event
verify-approvals covers approvals plus fallback
every exec logs model id
```
