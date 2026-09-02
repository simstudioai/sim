// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/agent-cli.ts
// Regenerate with `bun run contracts:sync` in the worker.

/**
 * The mothership↔sim wire for one Sim CLI invocation (docs/revamp/18-agent-surface.md
 * §4, Phase A0). The worker's translation layer decides everything — which command,
 * which augmentation, whether the result lands on the caller's machine — and sim
 * executes exactly what it is handed: no re-parsing, no policy. Slicing (`| grep`,
 * `| jq`, `| outline`) never crosses this wire: the worker applies it to whatever comes
 * back, so every command pipes the same way regardless of where it is answered.
 */

/** The result lands on the caller's machine (the chat's sandbox) instead of the window. */
export interface AgentCliSandboxFileSink {
  kind: "sandbox-file";
  /** File name or path on the caller's machine; relative paths resolve under its home. */
  path: string;
}

export type AgentCliSink = AgentCliSandboxFileSink;

/** A real Sim CLI command, run in-process against the embedded CLI. */
export interface AgentCliCliInvocation {
  kind: "cli";
  /** argv tokens with global rendering flags and any pipeline already stripped. */
  argv: string[];
}

/** An agent-only command, run by sim's engine of the same name with typed inputs. */
export interface AgentCliAugmentationInvocation {
  kind: "augmentation";
  /** The registry's canonical name, e.g. "grep" or "workflows lint". */
  name: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

/**
 * Text the worker already has (a sliced result, or a worker-answered command's
 * output) that only needs the sink applied: sim writes it and answers with the notice.
 */
export interface AgentCliStdoutInvocation {
  kind: "stdout";
  stdout: string;
}

export type AgentCliInvocation =
  | AgentCliCliInvocation
  | AgentCliAugmentationInvocation
  | AgentCliStdoutInvocation;

export interface AgentCliRequest {
  invocation: AgentCliInvocation;
  sink?: AgentCliSink;
  /**
   * Viewer curation sim applies to the raw result before the sink: "block" trims a
   * block detail to the operations, inputs and models this viewer may use. Decided by the
   * worker's parse, applied by sim's primitive, so both sides see one policy.
   */
  curate?: "block";
}

/** What sim hands back: the CLI's own three channels, untouched. */
export interface AgentCliRawResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
