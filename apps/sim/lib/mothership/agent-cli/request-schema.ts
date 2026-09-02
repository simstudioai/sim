import { z } from 'zod'
import type { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'

/**
 * Runtime validation of the worker's typed request (the generated contract carries only
 * the TypeScript shape). Validation is the ONLY thing this side does with the request
 * before executing it — no re-parsing, no routing decisions.
 */
const grepStageSchema = z.object({
  kind: z.literal('grep'),
  pattern: z.string(),
  ignoreCase: z.boolean(),
  invert: z.boolean(),
  countOnly: z.boolean(),
  lineNumbers: z.boolean(),
  maxCount: z.number().int().positive().optional(),
  linesBefore: z.number().int().nonnegative(),
  linesAfter: z.number().int().nonnegative(),
})

export const agentCliRequestSchema = z.object({
  invocation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('cli'), argv: z.array(z.string()).min(1).max(64) }),
    z.object({
      kind: z.literal('augmentation'),
      name: z.string().min(1),
      positionals: z.array(z.string()),
      flags: z.record(z.string(), z.union([z.string(), z.literal(true)])),
    }),
  ]),
  pipeline: z.array(
    z.discriminatedUnion('kind', [
      grepStageSchema,
      z.object({ kind: z.literal('jq'), expression: z.string().min(1).max(4_000) }),
      z.object({ kind: z.literal('outline') }),
    ])
  ),
  sink: z.object({ kind: z.literal('sandbox-file'), path: z.string().min(1).max(300) }).optional(),
}) satisfies z.ZodType<AgentCliRequest>
