# Provider

Session provider is opencode-go.
Session model is muse-spark-1.3-contributor.
Zot cannot reuse that subscription auth.
No exportable key was found in env.
Opencode auth files held no exportable key.
So zot keeps echo fallback by default.

Live path uses OpenAI chat completions.
Router file is `src/router.js`.
Live model id is `openai-mini`.
Upstream model is `gpt-4o-mini`.
Sync `exec` always returns echo text.
Async `execAsync` uses live provider when key exists.
Helper `isLiveConfigured` reports key presence.
Every call logs model id.

Setup needs one env var.

```
OPENAI_API_KEY=... node daemon.js
```

Optional vars tune behavior.

```
ZOT_OPENAI_MODEL=gpt-4o-mini
ZOT_MODEL_TIMEOUT_MS=15000
```

Fallback behavior is offline safe.
Without a key live model returns echo text.
The reply keeps the live model id.
The text uses echo shape.
Eval stays green offline.

Verify with these commands.

```
node --check src/router.js
OPENAI_API_KEY= node scripts/verify-router.js
npm run eval
```

Keys live only in env.
Never commit a key.
This doc names vars only.
