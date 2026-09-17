// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/integration-catalog.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

/** Nonsecret executor claims, originally verified by Sim; never includes a bearer token. */
export const IntegrationCatalogMcpExecution = z.strictObject({
  workflowId: z.string().min(1),
  executionId: z.string().min(1).optional(),
  mcpBlockId: z.string().min(1),
  subjectUserId: z.string().min(1).optional(),
  /** Sim's canonical serializePrincipal/parsePrincipal contract owns this JSON envelope. */
  principal: z.json().optional(),
  currentWorkflow: z
    .discriminatedUnion("mode", [
      z.strictObject({ workflowId: z.string().min(1), mode: z.literal("draft") }),
      z.strictObject({
        workflowId: z.string().min(1),
        mode: z.literal("deployment"),
        deploymentVersionId: z.string().min(1),
      }),
    ])
    .optional(),
});
export type IntegrationCatalogMcpExecution = z.infer<typeof IntegrationCatalogMcpExecution>;

/** Discovery scope only; operation schemas are resolved by Sim when requested. */
export const IntegrationCatalogContext = z.object({
  mcpServerIds: z.array(z.string().min(1)).default([]),
  mcpToolIds: z.array(z.string().min(1)).optional(),
  mcpExecution: IntegrationCatalogMcpExecution.optional(),
});
export type IntegrationCatalogContext = z.infer<typeof IntegrationCatalogContext>;

export const IntegrationCatalogRequest = IntegrationCatalogContext.extend({
  mode: z.enum(["agent", "assistant"]),
  workspaceId: z.uuid().optional(),
  query: z.string().max(2_000).optional(),
  service: z.string().max(200).optional(),
  toolId: z.string().max(500).optional(),
  limit: z.number().int().nonnegative().safe().default(20),
});
export type IntegrationCatalogRequest = z.infer<typeof IntegrationCatalogRequest>;

export const IntegrationCatalogResponse = z.object({
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  operations: z.array(
    z.object({
      toolId: z.string().min(1),
      service: z.string().optional(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
export type IntegrationCatalogResponse = z.infer<typeof IntegrationCatalogResponse>;
