import { z } from 'zod'

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
const prioritySchema = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .describe('0 none, 1 low, 2 medium, 3 high, 4 urgent.')

/** File an issue, read one back by key, or hand the issue this chat works on back for review. */
export const mothershipIssuesInputSchema = z.discriminatedUnion('action', [
  scope
    .extend({
      action: z.literal('create'),
      title: z.string().trim().min(1).max(200).describe('What is going wrong, in one line.'),
      body: z
        .string()
        .max(1024 * 1024)
        .describe(
          'The issue document in markdown: what is happening and the evidence. Dashboard, diff, and mermaid blocks render live.'
        ),
      priority: prioritySchema.optional(),
    })
    .strict(),
  scope
    .extend({
      action: z.literal('get'),
      key: z.string().trim().min(1).max(32).describe('Issue key, such as SIM-152.'),
    })
    .strict(),
  scope
    .extend({
      action: z.literal('request-review'),
      key: z.string().trim().min(1).max(32).describe('Issue key, such as SIM-152.'),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe('One line on what you found or changed, for the person reviewing.'),
    })
    .strict(),
])
