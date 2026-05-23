# pi-ygrep

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pi extension replacing `grep` with [ygrep](https://github.com/yetidevworks/ygrep) indexed search.

**Author:** [w1zdun](https://github.com/w1zdun)

## Features

- **Subtoken matching**: `send` → `sendCampaign`, `send_email`, `handleSendRequest`
- **Multi-word AND**: `api error` = files containing BOTH terms
- **Semantic search**: conceptual matches beyond literal text (with `--semantic` index)
- **Special chars literal**: `$var`, `->get()`, `@decorator`, `{% block %}`

## Install

```bash
# Via pi (global)
pi install git:github.com/w1zdun/pi-ygrep

# Via pi (project-local)
pi install git:github.com/w1zdun/pi-ygrep -l
```

Or manually:

```bash
git clone https://github.com/w1zdun/pi-ygrep.git
cd pi-ygrep
npm install && npx tsc

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

## Commands

| Command | Description |
|---------|-------------|
| `/ygrep-status` | Show index status (files, type, semantic) |
| `/ygrep-rebuild` | Rebuild text-only index (fast) |
| `/ygrep-semantic-rebuild` | Rebuild with semantic search (slower) |
| `/ygrep-watch` | Start watch mode (background) |
| `/ygrep-indexes` | List all indexed workspaces |
| `/ygrep-clean` | Remove unused indexes |
| `/ygrep-reset` | Delete current index + rebuild |
| `/ygrep-widget-toggle` | Show/hide the status widget |

## Config

Create `.pi/extensions/ygrep.json` (project) or `~/.pi/agent/extensions/ygrep.json` (global):

```json
{
  "enabled": true,
  "autoIndex": true,
  "autoWatch": true,
  "defaultSemantic": false,
  "skipNonGit": false
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Master switch |
| `autoIndex` | `true` | Auto-build index on session start (git repos) |
| `autoWatch` | `true` | Start `ygrep watch --daemon` in background |
| `defaultSemantic` | `false` | Use semantic index by default |
| `skipNonGit` | `false` | Skip non-git folders entirely |

## Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Pi extension (overrides `grep` tool) |
| `skills/ygrep/SKILL.md` | Skill for indexing + usage patterns |
| `package.json` | Dependencies + pi manifest |
| `ygrep.json.example` | Config template |

## License

MIT — Copyright (c) 2026 w1zdun
