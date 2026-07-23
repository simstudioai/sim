import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const workspaceScopeSchema = z.enum(['active', 'archived', 'all'])
export const workspaceModeSchema = z.enum(['personal', 'organization', 'grandfathered_shared'])
export const workspacePermissionSchema = z.enum(['admin', 'write', 'read'])
export type WorkspaceMode = z.output<typeof workspaceModeSchema>
export type WorkspacePermission = z.output<typeof workspacePermissionSchema>

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  ownerId: z.string(),
  organizationId: z.string().nullable(),
  workspaceMode: workspaceModeSchema,
  role: z.string().optional(),
  membershipId: z.string().optional(),
  permissions: workspacePermissionSchema.nullable().optional(),
  billedAccountUserId: z.string().nullable().optional(),
  allowPersonalApiKeys: z.boolean().optional(),
  inviteMembersEnabled: z.boolean().optional(),
  inviteDisabledReason: z.string().nullable().optional(),
  inviteUpgradeRequired: z.boolean().optional(),
  // Source workspace id when this was created as a fork (null otherwise). Optional
  // because not every workspace response builder includes the column.
  forkedFromWorkspaceId: z.string().nullable().optional(),
})

export type Workspace = z.output<typeof workspaceSchema>

export const workspaceCreationPolicySchema = z.object({
  canCreate: z.boolean(),
  workspaceMode: workspaceModeSchema,
  organizationId: z.string().nullable(),
  maxWorkspaces: z.number().nullable(),
  currentWorkspaceCount: z.number(),
  reason: z.string().nullable(),
})

export type WorkspaceCreationPolicy = z.output<typeof workspaceCreationPolicySchema>

export const listWorkspacesQuerySchema = z.object({
  scope: workspaceScopeSchema.default('active'),
})

export type WorkspaceQueryScope = NonNullable<z.input<typeof listWorkspacesQuerySchema>['scope']>

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  skipDefaultWorkflow: z.boolean().optional().default(false),
})

export const workspaceParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logoUrl: z
    .string()
    .refine((val) => val.startsWith('/') || val.startsWith('https://'), {
      message: 'Logo URL must be an absolute path or HTTPS URL',
    })
    .nullable()
    .optional(),
  billedAccountUserId: z.string().optional(),
  allowPersonalApiKeys: z.boolean().optional(),
})

export const deleteWorkspaceBodySchema = z.object({})

export const workspaceUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  permissionType: workspacePermissionSchema,
  isExternal: z.boolean(),
  joinedAt: z.string(),
  roleSource: z.enum(['owner', 'explicit', 'org-admin']),
})

export type WorkspaceUser = z.output<typeof workspaceUserSchema>

export const workspacePermissionsViewerSchema = z.object({
  userId: z.string(),
  isAdmin: z.boolean(),
  permissionType: workspacePermissionSchema,
})

export type WorkspacePermissionsViewer = z.output<typeof workspacePermissionsViewerSchema>

export const workspacePermissionsResponseSchema = z.object({
  users: z.array(workspaceUserSchema),
  total: z.number().int(),
  viewer: workspacePermissionsViewerSchema.optional(),
})

export type WorkspacePermissions = z.output<typeof workspacePermissionsResponseSchema>

export const updateWorkspacePermissionsBodySchema = z.object({
  updates: z.array(
    z.object({
      userId: z.string(),
      permissions: workspacePermissionSchema,
    })
  ),
})

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export type WorkspaceMember = z.output<typeof workspaceMemberSchema>

export const workspacePreviewBodySchema = z
  .object({
    code: z
      .string({ error: 'code is required' })
      .refine((code) => code.trim().length > 0, { message: 'code is required' }),
  })
  .passthrough()

export const workspaceMetricsExecutionsQuerySchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  segments: z.coerce.number().min(1).max(200).default(72),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  level: z.string().optional(),
  allTime: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const listWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces',
  query: listWorkspacesQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaces: z.array(workspaceSchema),
      lastActiveWorkspaceId: z.string().nullable(),
      creationPolicy: workspaceCreationPolicySchema.nullable(),
    }),
  },
})

export const createWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces',
  body: createWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspace: workspaceSchema,
    }),
  },
})

export const getWorkspaceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspace: workspaceSchema,
    }),
  },
})

/**
 * Subscription access fields of the workspace's billed account (its OWNER's
 * rolled-up plan) — the workspace-scoped counterpart to the viewer `/api/billing`
 * data. Feed to `getSubscriptionAccessState` to gate workspace features on the
 * owner's plan instead of the signed-in viewer's. No usage/credit data.
 */
export const workspaceOwnerBillingSchema = z.object({
  plan: z.string(),
  status: z.string().nullable(),
  isPaid: z.boolean(),
  isPro: z.boolean(),
  isTeam: z.boolean(),
  isEnterprise: z.boolean(),
  isOrgScoped: z.boolean(),
  organizationId: z.string().nullable(),
  billingInterval: z.enum(['month', 'year']),
  billingBlocked: z.boolean(),
  billingBlockedReason: z.enum(['payment_failed', 'dispute']).nullable(),
})

export type WorkspaceOwnerBilling = z.output<typeof workspaceOwnerBillingSchema>

export const workspaceHostContextSchema = z.object({
  workspace: z.object({
    id: nonEmptyIdSchema,
    name: z.string().min(1),
    workspaceMode: workspaceModeSchema,
    billedAccountUserId: nonEmptyIdSchema,
  }),
  hostOrganizationId: nonEmptyIdSchema.nullable(),
  ownerBilling: workspaceOwnerBillingSchema,
  viewer: z.object({
    permission: workspacePermissionSchema,
    isHostOrganizationMember: z.boolean(),
    isHostOrganizationAdmin: z.boolean(),
  }),
})

export type WorkspaceHostContext = z.output<typeof workspaceHostContextSchema>

export const getWorkspaceHostContextContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/host-context',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceHostContextSchema,
  },
})

export const workspaceCreditAvailabilitySchema = z.object({
  remainingDollars: z.number().nonnegative().nullable(),
  scope: z.enum(['payer', 'member', 'effective']),
})

export type WorkspaceCreditAvailability = z.output<typeof workspaceCreditAvailabilitySchema>

export const getWorkspaceCreditAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/credit-availability',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceCreditAvailabilitySchema,
  },
})

export const workspaceUsageGateSchema = z.object({
  isExceeded: z.boolean(),
  message: z.string().min(1).nullable(),
  scope: z.enum(['actor', 'payer', 'member']).nullable(),
})

export type WorkspaceUsageGate = z.output<typeof workspaceUsageGateSchema>

export const getWorkspaceUsageGateContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/usage-gate',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceUsageGateSchema,
  },
})

export const updateWorkspaceContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]',
  params: workspaceParamsSchema,
  body: updateWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspace: workspaceSchema,
    }),
  },
})

export const deleteWorkspaceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]',
  params: workspaceParamsSchema,
  body: deleteWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const getWorkspacePermissionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/permissions',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: workspacePermissionsResponseSchema,
  },
})

export const updateWorkspacePermissionsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/permissions',
  params: workspaceParamsSchema,
  body: updateWorkspacePermissionsBodySchema,
  response: {
    mode: 'json',
    schema: workspacePermissionsResponseSchema.extend({
      message: z.string(),
    }),
  },
})

export const getWorkspaceMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/members',
  params: workspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      members: z.array(workspaceMemberSchema),
    }),
  },
})

export type WorkspacesResponse = ContractJsonResponse<typeof listWorkspacesContract>
