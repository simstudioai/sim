import { z } from 'zod'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'

export const workspacePermissionUpdatesSchema = z.object({
  updates: z
    .array(
      z.object({
        userId: requiredFieldSchema('User ID is required').max(128, 'User ID is too long'),
        permissions: z.enum(['admin', 'write', 'read']),
      })
    )
    .min(1, 'updates must contain at least one permission change')
    .max(100, 'Cannot update more than 100 permissions at once')
    /**
     * One entry per user. Repeating a userId made the batch self-contradictory:
     * the route's guards inspect the first matching entry while the write loop
     * applied every entry in order, so a second entry could carry a role the
     * guards had already vetted the first one against.
     */
    .superRefine((updates, ctx) => {
      const seen = new Set<string>()
      for (const [index, update] of updates.entries()) {
        if (seen.has(update.userId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'userId'],
            message: 'Each user may appear only once in updates',
          })
          return
        }
        seen.add(update.userId)
      }
    }),
})

export type WorkspacePermissionUpdate = z.output<
  typeof workspacePermissionUpdatesSchema
>['updates'][number]
