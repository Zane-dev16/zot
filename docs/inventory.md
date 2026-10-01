# zot competitor inventory

Goal. Define v0 scope for zot from live competitors.
Repo status. Empty repo at /root/zot on 2026-09-30. This file is read only research. No code was changed.

Sources read this session.
- Grok Bot launch post at https://x.ai/news/introducing-grok-bot
- Grok Bot product page at https://x.ai/bot
- Dots guide at https://learn.chatgpt.com/docs/dots
- Dots safety FAQ at https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs
- Hermes agent repo at https://github.com/nousresearch/hermes-agent
- Hermes docs index at https://hermes-agent.nousresearch.com/docs/
- Hermes cron docs at https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
- Hermes messaging gateway at https://nousresearch-hermes-agent.mintlify.app/user-guide/messaging
- Hermes native MCP ref at https://github.com/NousResearch/hermes-agent/blob/HEAD/skills/autonomous-ai-agents/hermes-agent/references/native-mcp.md
- Muse Spark model page at https://developer.meta.com/ai/models/muse-spark-1-1/
- Muse Spark dev guide at https://developer.meta.com/ai/resources/blog/build-with-muse-spark/

## Ranked feature matrix

| Rank | Feature | Grokbot | Dots | Hermes | Muse | Verdict for zot |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Always on daemon plus supervisor | Yes. Own cloud computer. Works after laptop closes | Yes. Cloud computer. Works while devices are off | Yes. Gateway process plus VPS or serverless hibernate | No. Model only. Host supplies runtime | Must have for v0 |
| 2 | Agent runner with tool loop | Yes. Uses tools like user. Finishes end to end | Yes. Background agents in parallel | Yes. Conversation loop plus subagents plus RPC scripts | Yes. Tool use plus computer use plus multi agent | Must have for v0 |
| 3 | Localhost browser chat UI | Yes. Desktop and iOS app | Yes. Desktop app plus web plus mobile | Yes. Desktop app plus CLI plus TUI | No. API only | Must have for v0 |
| 4 | iOS app bridge via API plus push | Yes. iOS app ships | Yes. Mobile app plus call plus Slack plus Teams | Yes. Telegram plus Discord plus WhatsApp plus Signal plus voice memo | No | Must have for v0 |
| 5 | Scheduler plus cron | Yes. 24/7 workers | Yes. Scheduled plus recurring tasks | Yes. Natural language cron plus pause plus resume plus delivery | No | Must have for v0 |
| 6 | Memory plus vector store | Yes. Remembers how you work | Yes. Memory plus saved notes plus cross channel context | Yes. Curated memory plus FTS5 search plus Honcho user model | Yes. Long context plus multi turn memory | Must have for v0 |
| 7 | Skills plus MCP | Yes. Plugins plus browser | Yes. 4000 plus app plugins plus local skills | Yes. Native MCP client plus autonomous skill creation | Yes. Tool calling primitives | Must have for v0 |
| 8 | Sandbox plus approvals | Yes. Approval before sensitive acts | Yes. Approval checks plus Take over plus Return control | Yes. Docker plus SSH plus Modal plus Daytona plus Vercel Sandbox | Partial. Caller enforces policy | Must have for v0 |
| 9 | Wake word plus voice | Unclear. Message like colleague | Yes. Phone call plus type while talking | Yes. Voice memo transcription | Yes. Native multimodal perception | Must have for v0 |
| 10 | Multi model routing | Unclear. Tied to Grok | Unclear. Tied to GPT-6 Astra | Yes. OpenRouter plus OpenAI plus custom plus one command switch | No. Muse family only | Must have for v0 |
| 11 | Evals plus logs | Yes. Engineering guides show review loop | Yes. Activity view plus task history | Yes. Trajectory generation plus compression for training | Yes. Coding evals published | Must have for v0 |
| 12 | Chatops bridge plus channel memory | Yes. Works across apps and inboxes | Yes. Same dot in ChatGPT plus Slack plus Teams | Yes. One memory across all surfaces | No | Must have for v0 |
| 13 | Computer use plus browser takeover | Yes. Signs into tools and drives them | Yes. Cloud browser plus Take over plus local computer link | Partial. Browser provider plus seven terminal backends | Yes. Computer use is core strength | Later |
| 14 | Bot roster plus delegation | Yes. Fleet of named bots | Yes. Several dots in parallel | Yes. Bot Mode plugin plus isolated subagents | Yes. Multi agent orchestration | Later |
| 15 | Website sign in vault | Yes. App auth via plugins | Yes. Private sign in flow plus Save to Passwords | Partial. Credential pool plus persistence | No | Later |
| 16 | Research mode plus proactive nudges | Partial. Learns how you like work | Yes. Proactive research plus followups | Yes. Periodic nudges plus self improving skills | Partial | Later |

## Top 12 must haves for zot v0

1. Always on daemon with supervisor. Process restarts on crash. Work survives laptop close.
2. Agent runner with tool loop. Stream output. Interrupt and redirect. Subagents for parallel work.
3. Localhost browser chat UI. Simple web client for desktop. Same API serves mobile later.
4. iOS app bridge via API plus push. Phone sends prompts. Server pushes results and approvals.
5. Wake word plus voice. Hands free start. Voice memo input. Call style duplex where cheap.
6. Scheduler plus cron. Natural language schedules. Pause plus resume plus delivery to chat.
7. Memory plus vector store. Saved notes. FTS plus semantic search. Cross session recall.
8. Skills plus MCP. Native MCP client. Local skills folder. Agentskills compatible.
9. Sandbox plus approvals. Docker default. Approval gate before sends and writes.
10. Multi model routing. One command model switch. No lock in to one vendor.
11. Evals plus logs. Activity view. Trajectory logs. One command replay for regressions.
12. Chatops bridge plus channel memory. One agent across CLI plus Telegram plus Slack. Shared memory.

## Later

- Full computer use with takeover.
- Named bot fleet with bot to bot messages.
- Password vault for website logins.
- Proactive research nudges.
- Honcho style user modeling.
- Training trajectory export.

## Notes for builder

- Hermes is the closest open template. MIT license. Gateway plus cron plus MCP plus memory already proven.
- Dots is the best UX template. Same agent everywhere. Activity view. Take over pattern.
- Grokbot proves demand for persistent named teammates with their own computers.
- Muse proves model side needs. Long horizon tool use plus computer use plus coding evals.
