import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// --- Config ---
export interface YgrepConfig {
	enabled: boolean;
	autoIndex: boolean;
	autoWatch: boolean;
	defaultSemantic: boolean;
	skipNonGit: boolean;
}

const DEFAULT_CONFIG: YgrepConfig = {
	enabled: true,
	autoIndex: true,
	autoWatch: true,
	defaultSemantic: false,
	skipNonGit: false,
};

function loadConfig(cwd: string): YgrepConfig {
	const projectPath = join(cwd, ".pi", "extensions", "ygrep.json");
	const globalPath = join(
		process.env.HOME || "",
		".pi",
		"agent",
		"extensions",
		"ygrep.json",
	);
	const path = existsSync(projectPath)
		? projectPath
		: existsSync(globalPath)
			? globalPath
			: null;
	if (!path) return DEFAULT_CONFIG;
	try {
		return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(path, "utf-8")) };
	} catch {
		return DEFAULT_CONFIG;
	}
}

// --- Schema (compatible with built-in grep) ---
const grepSchema = Type.Object({
	pattern: Type.String({
		description:
			"Search query. ygrep uses subtoken matching ('send' → sendCampaign, send_email) and multi-word AND logic. Use -r flag via bash for regex.",
	}),
	path: Type.Optional(
		Type.String({
			description: "Directory to search in (default: current directory)",
		}),
	),
	glob: Type.Optional(
		Type.String({
			description: "File extension filter (e.g. '*.ts'). Maps to ygrep -e",
		}),
	),
	ignoreCase: Type.Optional(
		Type.Boolean({
			description: "Case-insensitive (default: true, ygrep default)",
		}),
	),
	literal: Type.Optional(
		Type.Boolean({
			description: "Ignored — ygrep always uses literal/subtoken matching",
		}),
	),
	context: Type.Optional(
		Type.Number({ description: "Context lines (-K). Maps to ygrep -K" }),
	),
	limit: Type.Optional(
		Type.Number({ description: "Max results (default: 100)" }),
	),
});

const DEFAULT_LIMIT = 100;

// Widget toggle state — shadow of ctx.ui widget visibility.
// Kept in sync wherever code calls setWidget("ygrep-status", …).
const widgetState = { widgetVisible: false };

// Watch daemon state — shadow flag set when this session started a watcher.
// ygrep has no query API for running watchers, so we track our own starts;
// it doesn't observe daemons started outside the session.
const watchState = { startedInSession: false };

function buildStatusLines(
	cwd: string,
	status: {
		indexed: boolean;
		type: string;
		semantic: boolean;
	},
	git: boolean,
): string[] {
	const lines = [
		`Workspace: ${cwd}`,
		`Git repo: ${git ? "✅ yes" : "❌ no"}`,
		`Indexed: ${status.indexed ? "✅ yes" : "❌ no"}`,
		`Type: ${status.type}`,
		`Semantic: ${status.semantic ? "✅ yes" : "❌ no"}`,
		`Watch: ${watchState.startedInSession ? "✅ started (background)" : "❌ not started"}`,
	];
	if (!status.indexed) {
		lines.push("", "Run: /ygrep-rebuild or /ygrep-semantic-rebuild");
	}
	return lines;
}

// --- ygrep grep tool ---
function createYgrepGrepTool(cwd: string) {
	return {
		name: "grep" as const,
		label: "grep (ygrep)" as const,
		description: [
			"Search file contents using ygrep (indexed text + optional semantic search).",
			"",
			"Returns AI-optimized output: path:line (score%) with match indicators.",
			"",
			"Pattern matching:",
			"- Subtoken: 'send' matches sendCampaign, send_email, handleSendRequest",
			"- Multi-word: 'api error' = files containing BOTH terms (AND logic)",
			"- Special chars work literal: $var, ->get(), @decorator, {% block %}",
			"",
			"Match indicators:",
			"  +  hybrid match (text AND semantic)",
			"  ~  semantic only (conceptual match)",
			"  (none) text match only",
			"",
			"For regex patterns, use bash tool: ygrep 'pattern' -r",
			"For full context, use bash tool: ygrep 'query' --pretty",
		].join("\n"),
		promptSnippet:
			"Search file contents with ygrep (indexed, subtoken + semantic)",
		parameters: grepSchema,
		async execute(
			_id: string,
			input: {
				pattern: string;
				path?: string;
				glob?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			},
			signal?: AbortSignal,
		): Promise<{
			content: Array<{ type: "text"; text: string }>;
			details: Record<string, unknown>;
		}> {
			if (signal?.aborted) throw new Error("Aborted");

			const { pattern, path: searchDir, glob, context, limit } = input;
			const effectiveLimit = limit ?? DEFAULT_LIMIT;

			const args: string[] = [pattern, "-n", String(effectiveLimit)];

			if (searchDir) {
				args.push("-C", `${cwd}/${searchDir}`);
			} else {
				args.push("-C", cwd);
			}

			if (glob) {
				const ext = glob.replace(/[*?.]/g, "");
				if (ext) args.push("-e", ext);
			}

			if (context) {
				args.push("-K", String(context));
			}

			return new Promise((resolve, reject) => {
				const child: ChildProcess = spawn("ygrep", args, {
					stdio: ["ignore", "pipe", "pipe"],
					signal,
				});

				const stdoutChunks: Buffer[] = [];
				const stderrChunks: Buffer[] = [];

				child.stdout!.on("data", (c: Buffer) => stdoutChunks.push(c));
				child.stderr!.on("data", (c: Buffer) => stderrChunks.push(c));

				child.on("error", (err: Error) => reject(err));
				child.on("close", (code: number) => {
					if (signal?.aborted) {
						reject(new Error("Aborted"));
						return;
					}
					const stdout = Buffer.concat(stdoutChunks).toString().trim();
					const stderr = Buffer.concat(stderrChunks).toString().trim();

					if (code !== 0) {
						const msg = stderr || `ygrep exited with code ${code}`;
						if (!stdout) {
							reject(new Error(msg));
							return;
						}
					}

					const result = {
						content: [
							{ type: "text" as const, text: stdout || "No matches found" },
						],
						details: {},
					};
					resolve(result);
				});
			});
		},
	};
}

// --- ygrep helpers ---
// `ygrep watch` is blocking by design (no --daemon flag). Spawn it detached so
// the parent (pi) doesn't keep it tied to its lifecycle. Resolves true once the
// child has stayed alive briefly without exiting/erroring.
function startYgrepWatchDetached(cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn("ygrep", ["watch"], {
				cwd,
				stdio: "ignore",
				detached: true,
			});
		} catch {
			resolve(false);
			return;
		}
		child.unref();
		let settled = false;
		const settle = (ok: boolean) => {
			if (settled) return;
			settled = true;
			resolve(ok);
		};
		child.on("error", () => settle(false));
		child.on("exit", () => settle(false));
		setTimeout(() => settle(true), 200);
	});
}

function runYgrep(
	args: string[],
	cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child: ChildProcess = spawn("ygrep", args, {
			stdio: ["ignore", "pipe", "pipe"],
			cwd,
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout!.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr!.on("data", (c: Buffer) => stderrChunks.push(c));
		child.on("error", () =>
			resolve({ code: 1, stdout: "", stderr: "ygrep not found" }),
		);
		child.on("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString().trim(),
				stderr: Buffer.concat(stderrChunks).toString().trim(),
			});
		});
	});
}

function isInGitRepo(cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child: ChildProcess = spawn(
			"git",
			["rev-parse", "--is-inside-work-tree"],
			{
				stdio: ["ignore", "pipe", "ignore"],
				cwd,
			},
		);
		let stdout = "";
		child.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
		child.on("close", (code) =>
			resolve(code === 0 && stdout.trim() === "true"),
		);
	});
}

function checkIndexStatus(cwd: string): Promise<{
	indexed: boolean;
	type: string;
	semantic: boolean;
}> {
	return runYgrep(["status"], cwd).then(({ stdout }) => {
		const indexed = stdout.includes("Indexed: yes");
		const type = stdout.match(/Index type: (.+)/)?.[1] || "unknown";
		const semantic = type.includes("semantic");
		return { indexed, type, semantic };
	});
}

// --- Extension entry ---
export default async function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	const config = loadConfig(cwd);

	if (!config.enabled) {
		pi.registerCommand("ygrep-status", {
			description: "Show ygrep index status for current workspace",
			handler: async (_args, ctx) => {
				ctx.ui.notify("ygrep: disabled in config", "info");
			},
		});
		return;
	}

	const grepTool = createYgrepGrepTool(cwd);
	pi.registerTool(grepTool);

	// --- Commands ---
	pi.registerCommand("ygrep-status", {
		description: "Show ygrep index status for current workspace",
		handler: async (_args, ctx) => {
			const [status, git] = await Promise.all([
				checkIndexStatus(cwd),
				isInGitRepo(cwd),
			]);
			const lines = buildStatusLines(cwd, status, git);
			ctx.ui.setWidget("ygrep-status", lines);
			widgetState.widgetVisible = true;
		},
	});

	pi.registerCommand("ygrep-rebuild", {
		description: "Rebuild ygrep text-only index (fast)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("ygrep: rebuilding text index...", "info");
			const { code, stdout, stderr } = await runYgrep(["index"], cwd);
			if (code === 0) {
				const files = stdout.match(/Files indexed: (\d+)/)?.[1] || "?";
				ctx.ui.notify(`ygrep: text index rebuilt (${files} files)`, "info");
			} else {
				ctx.ui.notify(`ygrep: ${stderr || "failed"}`, "error");
			}
		},
	});

	pi.registerCommand("ygrep-semantic-rebuild", {
		description: "Rebuild ygrep index with semantic search (slower)",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"ygrep: rebuilding semantic index (this may take a while)...",
				"info",
			);
			const { code, stdout, stderr } = await runYgrep(
				["index", "--semantic"],
				cwd,
			);
			if (code === 0) {
				const files = stdout.match(/Files indexed: (\d+)/)?.[1] || "?";
				ctx.ui.notify(`ygrep: semantic index rebuilt (${files} files)`, "info");
			} else {
				ctx.ui.notify(`ygrep: ${stderr || "failed"}`, "error");
			}
		},
	});

	pi.registerCommand("ygrep-watch", {
		description: "Start ygrep watch in background (auto-update index on file changes)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("ygrep: starting watch mode (background)...", "info");
			const ok = await startYgrepWatchDetached(cwd);
			if (ok) {
				watchState.startedInSession = true;
				ctx.ui.notify("ygrep: watch started (background)", "info");
			} else {
				ctx.ui.notify("ygrep: failed to start watch", "error");
			}
		},
	});

	pi.registerCommand("ygrep-indexes", {
		description: "List all ygrep indexed workspaces",
		handler: async (_args, ctx) => {
			const { stdout, stderr } = await runYgrep(["indexes", "list"], cwd);
			if (stderr && !stdout) {
				ctx.ui.notify(`ygrep: ${stderr}`, "error");
			} else {
				ctx.ui.setWidget(
					"ygrep-indexes",
					stdout ? stdout.split("\n") : ["No indexes found"],
				);
			}
		},
	});

	pi.registerCommand("ygrep-clean", {
		description: "Remove unused ygrep indexes",
		handler: async (_args, ctx) => {
			const { code, stdout, stderr } = await runYgrep(
				["indexes", "clean"],
				cwd,
			);
			if (code === 0) {
				ctx.ui.notify(`ygrep: ${stdout || "nothing to clean"}`, "info");
			} else {
				ctx.ui.notify(`ygrep: ${stderr || "failed"}`, "error");
			}
		},
	});

	pi.registerCommand("ygrep-widget-toggle", {
		description: "Toggle ygrep status widget on/off",
		handler: async (_args, ctx) => {
			if (widgetState.widgetVisible) {
				ctx.ui.setWidget("ygrep-status", undefined);
				widgetState.widgetVisible = false;
				ctx.ui.notify("ygrep: widget hidden", "info");
				return;
			}
			const [status, git] = await Promise.all([
				checkIndexStatus(cwd),
				isInGitRepo(cwd),
			]);
			const lines = buildStatusLines(cwd, status, git);
			ctx.ui.setWidget("ygrep-status", lines);
			widgetState.widgetVisible = true;
			ctx.ui.notify("ygrep: widget shown", "info");
		},
	});

	pi.registerCommand("ygrep-reset", {
		description: "Delete current workspace index and rebuild",
		handler: async (_args, ctx) => {
			ctx.ui.notify("ygrep: deleting current index...", "info");
			const { code, stderr } = await runYgrep(["indexes", "remove", cwd], cwd);
			if (code === 0 || stderr.includes("not found")) {
				ctx.ui.notify("ygrep: rebuilding index...", "info");
				const { code: code2, stdout: out2 } = await runYgrep(
					["index", ...(config.defaultSemantic ? ["--semantic"] : [])],
					cwd,
				);
				if (code2 === 0) {
					const files = out2.match(/Files indexed: (\d+)/)?.[1] || "?";
					const type = config.defaultSemantic ? "semantic" : "text";
					ctx.ui.notify(
						`ygrep: ${type} index rebuilt (${files} files)`,
						"info",
					);
				} else {
					ctx.ui.notify(`ygrep: rebuild failed: ${stderr}`, "error");
				}
			} else {
				ctx.ui.notify(`ygrep: ${stderr || "failed"}`, "error");
			}
		},
	});

	// --- Auto-index + auto-watch on session start ---
	pi.on("session_start", async (_event, ctx) => {
		const git = await isInGitRepo(cwd);
		const status = await checkIndexStatus(cwd);

		if (status.indexed) {
			// Index exists — start watch if configured
			if (config.autoWatch) {
				startYgrepWatchDetached(cwd).then((ok) => {
					if (ok) {
						watchState.startedInSession = true;
						ctx.ui.notify("ygrep: watch started (background)", "info");
					}
				});
			}

			const semanticNote = status.semantic
				? ""
				: " (text-only — run /ygrep-semantic-rebuild for semantic)";
			ctx.ui.notify(
				`ygrep: active (${status.type})${semanticNote}`,
				"info",
			);
		} else if (git && config.autoIndex) {
			// Git repo + no index — auto-index
			const semanticFlag = config.defaultSemantic ? ["--semantic"] : [];
			ctx.ui.notify(
				`ygrep: no index, building ${config.defaultSemantic ? "semantic" : "text"} index...`,
				"info",
			);
			const { code, stdout } = await runYgrep(["index", ...semanticFlag], cwd);
			if (code === 0) {
				const files = stdout.match(/Files indexed: (\d+)/)?.[1] || "?";
				ctx.ui.notify(`ygrep: indexed ${files} files`, "info");
				if (config.autoWatch) {
					startYgrepWatchDetached(cwd).then((ok) => {
						if (ok) {
							watchState.startedInSession = true;
							ctx.ui.notify("ygrep: watch started (background)", "info");
						}
					});
				}
			} else {
				ctx.ui.notify("ygrep: index build failed", "error");
			}
		} else if (!git && !config.skipNonGit) {
			// Not in git repo — offer to index
			ctx.ui.notify(
				"ygrep: not in a git repo. Run /ygrep-rebuild to index this folder, or /ygrep-status for details.",
				"info",
			);
		}
	});

	// Clear shadow state on shutdown so a re-loaded module doesn't disagree
	// with a host that already cleared the widget at session boundary.
	pi.on("session_shutdown", async () => {
		widgetState.widgetVisible = false;
		watchState.startedInSession = false;
	});
}
