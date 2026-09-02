// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/agent-cli.ts
// Regenerate with `bun run contracts:sync` in the worker.

/**
 * The mothership↔sim wire for one Sim CLI invocation (docs/revamp/18-agent-surface.md
 * §0 + Phase A0). The WORKER owns the agent grammar — it parses the model's argv into
 * this typed request; sim executes it with generic primitives and never re-parses
 * tokens (no pipe splitting, no flag matching, no augmentation routing on the sim side).
 *
 * Wire-shared shape: sim's tool handler validates its frame arguments against this.
 */

/** One grep stage, fully parsed: sim applies it, it never interprets flags. */
export interface AgentCliGrepStage {
  kind: "grep";
  pattern: string;
  ignoreCase: boolean;
  invert: boolean;
  countOnly: boolean;
  lineNumbers: boolean;
  /** Stop after this many matching lines; absent = unbounded. */
  maxCount?: number;
  linesBefore: number;
  linesAfter: number;
}

/** A jq program applied to JSON stdout — the model's slicing tool; real jq semantics. */
export interface AgentCliJqStage {
  kind: "jq";
  expression: string;
}

/** Keys, types, and counts of JSON stdout to depth 3, no values — the shape, cheaply. */
export interface AgentCliOutlineStage {
  kind: "outline";
}

export type AgentCliPipeStage = AgentCliGrepStage | AgentCliJqStage | AgentCliOutlineStage;

/** Where stdout lands instead of the model window. */
export interface AgentCliSandboxFileSink {
  kind: "sandbox-file";
  /** Path on the chat's workbench sandbox. */
  path: string;
}

export type AgentCliSink = AgentCliSandboxFileSink;

/** The real CLI's own command tree, run in-process on sim. */
export interface AgentCliCliInvocation {
  kind: "cli";
  /** argv tokens with global rendering flags and any pipeline already stripped. */
  argv: string[];
}

/** An agent-only augmentation, resolved by the worker's registry to its sim engine. */
export interface AgentCliAugmentationInvocation {
  kind: "augmentation";
  /** Engine name, e.g. "workflow lint" — the registry's canonical path. */
  name: string;
  positionals: string[];
  /** `--flag value` / `--flag=value` → string; bare `--flag` → true. */
  flags: Record<string, string | true>;
}

export type AgentCliInvocation = AgentCliCliInvocation | AgentCliAugmentationInvocation;

export interface AgentCliRequest {
  invocation: AgentCliInvocation;
  pipeline: AgentCliPipeStage[];
  sink?: AgentCliSink;
}

/** What sim returns; the worker shapes the model-facing result from it. */
export interface AgentCliRawResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
