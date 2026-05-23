# pi-ygrep

Pi extension replacing `grep` with [ygrep](https://github.com/yetidevworks/ygrep) indexed search.

## Features

- **Subtoken matching**: `send` → `sendCampaign`, `send_email`, `handleSendRequest`
- **Multi-word AND**: `api error` = files containing BOTH terms
- **Semantic search**: conceptual matches beyond literal text (with `--semantic` index)
- **Special chars literal**: `$var`, `->get()`, `@decorator`, `{% block %}`

## Install

```bash
# Build
npm install
npx tsc

# Link to pi (global)
ln -sf $(pwd) ~/.pi/agent/extensions/ygrep

# Or project-local
ln -sf $(pwd) .pi/extensions/ygrep
```

## Setup

```bash
# Index workspace (one-time, reindex after large changes)
ygrep index              # text-only (fast)
ygrep index --semantic   # with semantic search

# Auto-update index
ygrep watch
```

## Usage

The `grep` tool is overridden. Use normally:

```
grep({ pattern: "functionName" })
grep({ pattern: "api error", path: "src/", limit: 20 })
grep({ pattern: "config", glob: "*.ts", context: 3 })
```

For regex or advanced flags, use `bash`:

```bash
ygrep "fn\\s+main" -r          # regex
ygrep "error" --pretty         # full context
ygrep "Config" -s              # case-sensitive
```

## Output

```
src/api/handler.py:42 (95%)
+ src/utils/auth.ts:17 (88%)     # hybrid (text + semantic)
~ src/models/user.py:103 (72%)   # semantic only
```

## Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Pi extension (overrides `grep` tool) |
| `skills/ygrep/SKILL.md` | Skill for indexing + usage patterns |
| `package.json` | Dependencies + pi manifest |
