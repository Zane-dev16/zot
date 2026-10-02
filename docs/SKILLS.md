# Skills

Skills load from JSON files in `skills`. Each file holds one skill with a tool list.

Fields are as follows:

- `name` names the skill.
- `description` explains the skill.
- `tools` lists callable entries. Each entry has `name` plus `command` or `mcp`.

## Local echo

`local.echo` is sync and has no spawn. It returns `args.text` as a string. It stays the default for offline checks.

## MCP stdio

An MCP tool has `mcp` with `command` plus `args`. `command` is a binary. `args` is a string array. Spawn uses no shell. Request args go to stdin as JSON. Server stdout is the result text. Output is capped at 2000 chars.

## Allowlist and timeout

Disk entries are the default allowlist. A caller can pass a narrower list. An unlisted command fails with `mcp command not allowed`. The default timeout is 5000 ms. A slow server fails instead of hanging. A bad definition fails with `bad mcp definition`. An unknown `mcp.` name keeps the old canned stub for compat.

Functions are as follows:

- `loadSkills(dir)` reads the directory and never throws.
- `findTool(tools, name)` looks up one entry by name.
- `mcpAllowlist(tools)` collects allowed commands from disk.
- `isMcpAllowed(command, allowlist)` checks one command.
- `execMcpSync(toolDef, args, opts)` spawns one server with timeout plus allowlist.
- `execSkillToolSync(tools, tool, args, opts)` keeps echo local and spawns MCP.
- `execSkill(tool, args)` keeps the old sync stub for compat.

## Verify

Commands are as follows:

- `node --check src/skills.js`
- `node --check scripts/verify-skills.js`
- `node scripts/verify-skills.js`
