import { z } from 'zod'
import {
  nonEmptyIdSchema,
  organizationRoleSchema,
  requiredFieldSchema,
} from '@/lib/api/contracts/primitives'
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
  /**
   * The viewer holds admin here through their organization role rather than a
   * permission row, so they cannot leave. Optional because not every workspace
   * response builder resolves organization standing.
   */
  isOrgAdmin: z.boolean().optional(),
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
  /**
   * Machine-readable discriminant for blocked states whose correct user-facing
   * copy the workspace mode alone cannot determine.
   */
  blockedReasonCode: z
    .enum(['organization-subscription-inactive', 'permission-group-denied'])
    .optional(),
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
  isOrgAdmin: z.boolean(),
  isBilledAccount: z.boolean(),
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

/**
 * Role changes for users who are **already** workspace members. The route
 * rejects any `userId` without an existing workspace permission row — adding a
 * collaborator goes through the invitation flow, which owns the plan, seat, and
 * consent gates this endpoint has no way to apply.
 */
export const updateWorkspacePermissionsBodySchema = z.object({
  updates: z
    .array(
      z.object({
        userId: requiredFieldSchema('User ID is required').max(128, 'User ID is too long'),
        permissions: workspacePermissionSchema,
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

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export type WorkspaceMember = z.output<typeof workspaceMemberSchema>

export const listWorkspacesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces',
  query: listWorkspacesQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaces: z.array(workspaceSchema),
      lastActiveWorkspaceId: z.string().nullable(),
      /**
       * Workspace ids the viewer pinned in the switcher, from `pinned_item`. May
       * name workspaces absent from `workspaces` (archived, or access since
       * removed); clients look pins up per rendered workspace, so unmatched ids
       * are inert and the pin survives if access is restored.
       */
      pinnedWorkspaceIds: z.array(z.string()).default([]),
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

/**
 * Enterprise features as this deployment's configuration resolves them (see
 * `enterpriseFeatureEnabled` in `@/lib/core/config/env-flags`). The browser consults
 * these only off-hosted, where no subscription plan exists to decide entitlement.
 */
export const deploymentFeaturesSchema = z.object({
  accessControl: z.boolean(),
  auditLogs: z.boolean(),
  customBlocks: z.boolean(),
  dataDrains: z.boolean(),
  dataRetention: z.boolean(),
  inbox: z.boolean(),
  sandboxes: z.boolean(),
  scim: z.boolean(),
  sessionPolicies: z.boolean(),
  sso: z.boolean(),
  usageMonitoring: z.boolean(),
  whitelabeling: z.boolean(),
})

export type DeploymentFeatures = z.output<typeof deploymentFeaturesSchema>

/**
 * The deployment's shape, resolved on the server per request. Browser code reads it
 * from the workspace host context rather than from the `NEXT_PUBLIC_*` module
 * constants: those freeze at module init, and a document that never ran the root
 * layout — Next's bare `__next_error__` 404 shell, or `global-error` — leaves every
 * one of them unset for the life of the tab, including after the app recovers in
 * place. See `@/lib/core/config/deployment-shape`.
 */
export const deploymentShapeSchema = z.object({
  hosted: z.boolean(),
  billingEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  azureConfigured: z.boolean(),
  cohereConfigured: z.boolean(),
  features: deploymentFeaturesSchema,
})

export type DeploymentShape = z.output<typeof deploymentShapeSchema>

export const workspaceHostContextSchema = z.object({
  workspace: z.object({
    id: nonEmptyIdSchema,
    name: z.string().min(1),
    workspaceMode: workspaceModeSchema,
    billedAccountUserId: nonEmptyIdSchema,
    /** Optional for rolling compatibility with app versions that predate API-key policy projection. */
    allowPersonalApiKeys: z.boolean().optional(),
  }),
  hostOrganizationId: nonEmptyIdSchema.nullable(),
  ownerBilling: workspaceOwnerBillingSchema,
  viewer: z.object({
    permission: workspacePermissionSchema,
    isHostOrganizationMember: z.boolean(),
    isHostOrganizationAdmin: z.boolean(),
    /** Optional for rolling compatibility with app versions that predate organization-role projection. */
    organizationRole: organizationRoleSchema.nullable().optional(),
  }),
  features: z
    .object({
      credentialGroups: z.boolean(),
      /** Optional for rolling compatibility with app versions that predate the flag. */
      knowledgeMemberAccess: z.boolean().optional(),
    })
    .optional(),
  /** Optional for rolling compatibility with app versions that predate deployment projection. */
  deployment: deploymentShapeSchema.optional(),
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
  /**
   * Acknowledgement only. The roster this used to echo was discarded by every
   * caller — the members list is owned by the GET above and refetched on
   * settle — so building it cost three queries per role change and made a
   * post-commit read failure able to report an applied change as a 500.
   */
  response: {
    mode: 'json',
    schema: z.object({ message: z.string() }),
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
