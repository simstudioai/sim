import { z } from 'zod'

const target = z.object({
  workspaceId: z.string().min(1).max(100).optional(),
  workflowId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,100}$/, 'workflowId must be a workflow id')
    .describe('The workflow the notes belong to.'),
})

/**
 * A workflow's build notes: the agent's hidden scratchpad at build-notes/<workflowId>.md, with
 * the graph Sim last recorded beside it at build-notes/<workflowId>.baseline.json.
 */
export const mothershipBuildNotesInputSchema = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('create') }).strict(),
  target.extend({ action: z.literal('status') }).strict(),
  target.extend({ action: z.literal('evaluate') }).strict(),
  target.extend({ action: z.literal('apply') }).strict(),
  target.extend({ action: z.literal('changes') }).strict(),
  target.extend({ action: z.literal('rebase') }).strict(),
])
