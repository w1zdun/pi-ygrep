# ygrep

Fast indexed code search. Replaces standard grep with subtoken matching, multi-word AND logic, and optional semantic search. Provides slash commands to manage the index (`/ygrep-status`, `/ygrep-rebuild`, `/ygrep-semantic-rebuild`, `/ygrep-watch`, `/ygrep-indexes`, `/ygrep-clean`, `/ygrep-reset`) and to show/hide the status widget (`/ygrep-widget-toggle`). Trigger on "ygrep status", "rebuild ygrep index", "toggle ygrep widget", "show/hide ygrep widget", "ygrep watch", "clean ygrep indexes".

## When to Use

- Any file content search (use `grep` tool — it's overridden to ygrep)
- Finding functions, variables, strings, patterns across codebase
- Semantic search: conceptual matches beyond literal text
- Subtoken search: `send` → `sendCampaign`, `send_email`, `handleSendRequest`

## Initialization

Before first search, index the workspace:

```bash
# Text-only (fast, ~seconds)
ygrep index

# With semantic search (slower, ~minutes)
ygrep index --semantic
```

Check status anytime:

```bash
ygrep status
```

## Usage via grep Tool

The `grep` tool is overridden to use ygrep. Call it normally:

```
grep({ pattern: "functionName", path: "src/" })
grep({ pattern: "api error", path: "src/", limit: 20 })
grep({ pattern: "config", glob: "*.ts", context: 3 })
```

Mapping:
- `pattern` → ygrep query (subtoken + multi-word AND)
- `path` → ygrep `-C` (workspace root)
- `glob` → ygrep `-e` (extension filter, `*.ts` → `ts`)
- `context` → ygrep `-K` (before + after lines)
- `limit` → ygrep `-n` (max results)
- `ignoreCase` → ygrep default (case-insensitive)
- `literal` → ignored (ygrep always literal/subtoken)

## Advanced (via bash)

```bash
# Regex
ygrep "fn\\s+main" -r

# Full context output
ygrep "error" --pretty

# Case-sensitive
ygrep "Config" -s

# JSON output
ygrep "api" --json

# Multiple extensions
ygrep "error" -e py -e ts

# Path filter
ygrep "error" -p "src/api/"
```

## Output Format

Default (AI-optimized):

```
src/api/handler.py:42 (95%)
+ src/utils/auth.ts:17 (88%)
~ src/models/user.py:103 (72%)
```

- `+` = hybrid (text + semantic match)
- `~` = semantic only (conceptual)
- `(no marker)` = text match only
- Percentage = relevance score

## Watch Mode

Auto-update index on file changes:

```bash
ygrep watch
```

## Common Patterns

- Find function: `grep({ pattern: "handleLogin" })`
- Find by concept: `grep({ pattern: "authentication middleware" })`
- Find in subdir: `grep({ pattern: "TODO", path: "src/api/" })`
- Find TypeScript only: `grep({ pattern: "interface", glob: "*.ts" })`
- Find with context: `grep({ pattern: "error", context: 3 })`
