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

import { z } from "zod";
import { FileOperationOwner } from "./file-owner";
import { ArtifactObservations } from "./observations";
import { ResourceChanges } from "./resources";
import { fileCopyDestinationSchema, fileCopySourceSchema } from "./sim-file-copy.generated";

/** Relative sink paths resolve under the chat workbench home. */
export const AgentCliSandboxFileSink = z.object({
  kind: z.literal("sandbox-file"),
  path: z.string().min(1).max(300),
});
export type AgentCliSandboxFileSink = z.infer<typeof AgentCliSandboxFileSink>;
export type AgentCliSink = AgentCliSandboxFileSink;

export const AgentCliCliInvocation = z.object({
  kind: z.literal("cli"),
  argv: z.array(z.string()).min(1).max(64),
});
export type AgentCliCliInvocation = z.infer<typeof AgentCliCliInvocation>;

export const AgentCliAugmentationInvocation = z.object({
  kind: z.literal("augmentation"),
  name: z.string().min(1),
  positionals: z.array(z.string()),
  flags: z.record(z.string(), z.union([z.string(), z.literal(true)])),
});
export type AgentCliAugmentationInvocation = z.infer<typeof AgentCliAugmentationInvocation>;

/** Already-executed output: apply only the requested sink, never repeat its source command. */
export const AgentCliStdoutInvocation = z.object({
  kind: z.literal("stdout"),
  stdout: z.string().max(50_000_000),
});
export type AgentCliStdoutInvocation = z.infer<typeof AgentCliStdoutInvocation>;

/** Internal product operations reuse Sim's authorized handlers; public CLI operations stay native. */
export const AgentCliServiceInvocation = z.object({
  kind: z.literal("service"),
  name: z.enum([
    "list_workspaces",
    "list_user_projects",
    "search_workspace",
    "read_document",
    "settings",
    "search_sources",
    "dashboards",
    "workspaces",
  ]),
  input: z.record(z.string(), z.json()),
  inputFiles: z.partialRecord(z.enum(["input", "changes"]), z.string().min(1).max(1000)).optional(),
});
export type AgentCliServiceInvocation = z.infer<typeof AgentCliServiceInvocation>;

export const AgentCliFileCopyInvocation = z.strictObject({
  kind: z.literal("file-copy"),
  argv: AgentCliCliInvocation.shape.argv,
  source: fileCopySourceSchema,
  destination: fileCopyDestinationSchema,
});
export type AgentCliFileCopyInvocation = z.infer<typeof AgentCliFileCopyInvocation>;

export const AgentCliInvocation = z.discriminatedUnion("kind", [
  AgentCliCliInvocation,
  AgentCliFileCopyInvocation,
  AgentCliAugmentationInvocation,
  AgentCliStdoutInvocation,
  AgentCliServiceInvocation,
]);
export type AgentCliInvocation = z.infer<typeof AgentCliInvocation>;

export const AgentCliRequest = z
  .object({
    fileOwner: FileOperationOwner.optional(),
    workspaceId: z.uuid().optional(),
    invocation: AgentCliInvocation,
    sink: AgentCliSandboxFileSink.optional(),
    curate: z.enum(["block", "knowledge-documents"]).optional(),
  })
  .superRefine((request, context) => {
    if (request.invocation.kind === "file-copy" && (request.fileOwner || request.workspaceId))
      context.addIssue({
        code: "custom",
        message: "File copy carries both owners in its invocation; omit envelope fileOwner and workspaceId.",
      });
  });
export type AgentCliRequest = z.infer<typeof AgentCliRequest>;

export const AgentCliRawResult = z.object({
  sinkError: z.string().optional(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string().default(""),
  observations: ArtifactObservations.optional(),
  resources: ResourceChanges.optional(),
});
export type AgentCliRawResult = z.infer<typeof AgentCliRawResult>;
