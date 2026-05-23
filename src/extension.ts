import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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

// --- Extension entry ---
export default function (pi: ExtensionAPI) {
	const grepTool = createYgrepGrepTool(process.cwd());
	pi.registerTool(grepTool);

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("ygrep: active (grep → ygrep indexed search)", "info");
	});
}
