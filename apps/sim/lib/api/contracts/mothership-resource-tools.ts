import { z } from 'zod'
import { FileOperationOwner } from '@/lib/mothership/generated/file-owner'

/** Requested targets only; canonical metadata comes from authorized reads. */
export const openResourceInputSchema = z
  .strictObject({
    workspaceId: z
      .string()
      .min(1)
      .optional()
      .describe('Explicit owning workspace in organization chat.'),
    resources: z
      .array(
        z.strictObject({
          type: z.enum(['workflow', 'table', 'knowledgebase', 'file', 'dashboard', 'log']),
          id: z.string().trim().min(1),
          owner: FileOperationOwner.optional(),
          viewId: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('Saved table view; table resources only.'),
        })
      )
      .min(1)
      .max(20),
  })
  .superRefine((input, ctx) => {
    const projects = input.resources.filter((resource) => resource.owner?.entityType === 'project')
    if (input.resources.some((resource) => resource.owner && resource.type !== 'file'))
      ctx.addIssue({
        code: 'custom',
        path: ['resources'],
        message: 'Explicit file owners apply only to files',
      })
    if (projects.length && (projects.length !== input.resources.length || input.workspaceId))
      ctx.addIssue({
        code: 'custom',
        path: ['resources'],
        message: 'Project files cannot be mixed with workspace targets',
      })
  })
export const openResourceOutputSchema = z.object({
  resources: z.array(
    z.object({
      type: z.enum(['workflow', 'table', 'knowledgebase', 'file', 'dashboard', 'log']),
      id: z.string(),
      title: z.string(),
      viewId: z.string().optional(),
      executionId: z.string().optional(),
      owner: FileOperationOwner.optional(),
    })
  ),
})
export type OpenResourceInput = z.infer<typeof openResourceInputSchema>
export type OpenResourceOutput = z.infer<typeof openResourceOutputSchema>
