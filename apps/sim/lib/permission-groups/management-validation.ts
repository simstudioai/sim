import { z } from 'zod'
import { permissionGroupConfigSchema } from '@/lib/permission-groups/fields'

/** Upper bound on how many workspaces a single group can explicitly target. */
export const MAX_PERMISSION_GROUP_WORKSPACES = 500

const workspaceIdsSchema = z.array(z.string().min(1)).max(MAX_PERMISSION_GROUP_WORKSPACES)

/**
 * The one cross-field scope rule shared by create and update: the organization
 * default group governs every workspace, so it cannot also name specific
 * workspaces (they would be silently dropped server-side). "Org-wide" is
 * definitionally `isDefault` — there is no separate flag — so a default group
 * with no `workspaceIds` is already the all-workspaces case and needs no
 * assertion here.
 *
 * Other scope rules are checked by the application: a non-default group targets the
 * workspaces in `workspaceIds` (empty is allowed on update — the group then
 * governs nothing, since the resolver inner-joins the workspace link table), and
 * the create route requires at least one workspace up front.
 */
function refineWorkspaceScope(
  body: { workspaceIds?: string[]; isDefault?: boolean },
  ctx: z.RefinementCtx
) {
  if (body.isDefault === true && body.workspaceIds && body.workspaceIds.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['workspaceIds'],
      message: 'The default group governs all workspaces and cannot target specific workspaces',
    })
  }
}

export const createPermissionGroupSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    config: permissionGroupConfigSchema.optional(),
    isDefault: z.boolean().optional(),
    workspaceIds: workspaceIdsSchema.optional(),
  })
  .superRefine(refineWorkspaceScope)
export type CreatePermissionGroupSettings = z.input<typeof createPermissionGroupSettingsSchema>

export const updatePermissionGroupSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    config: permissionGroupConfigSchema.optional(),
    isDefault: z.boolean().optional(),
    workspaceIds: workspaceIdsSchema.optional(),
  })
  .superRefine(refineWorkspaceScope)
export type UpdatePermissionGroupSettings = z.input<typeof updatePermissionGroupSettingsSchema>

export const bulkPermissionGroupMembersSchema = z.object({
  userIds: z.array(z.string()).optional(),
  addAllOrganizationMembers: z.boolean().optional(),
})
export type BulkPermissionGroupMembers = z.input<typeof bulkPermissionGroupMembersSchema>
