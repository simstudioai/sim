import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * The settings surface an organization administrator uses to configure directory
 * provisioning. Ordinary session-authenticated internal routes; the SCIM
 * protocol surface is separate and lives in `contracts/scim.ts`.
 */

const organizationParamsSchema = z.object({ id: organizationIdSchema })

const scimScopeSchema = z.enum(['users:read', 'users:write', 'groups:read', 'groups:write'])

export const scimConnectionSettingsSchema = z.object({
  lockManualMembership: z.boolean().optional(),
  disableJit: z.boolean().optional(),
  autoMapPermissionGroupsByName: z.boolean().optional(),
})
export type ScimConnectionSettingsInput = z.input<typeof scimConnectionSettingsSchema>

const scimCredentialSchema = z.object({
  id: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(scimScopeSchema),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})

const scimConnectionSchema = z.object({
  id: z.string(),
  status: z.enum(['active', 'disabled']),
  baseUrl: z.string(),
  settings: scimConnectionSettingsSchema,
  lastRequestAt: z.string().nullable(),
  reconciledAt: z.string().nullable(),
  createdAt: z.string(),
  credentials: z.array(scimCredentialSchema),
  userCount: z.number().int(),
  groupCount: z.number().int(),
})

export const getScimConnectionContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/scim',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ connection: scimConnectionSchema.nullable() }),
  },
})

export const configureScimConnectionContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/scim',
  params: organizationParamsSchema,
  body: z.object({
    status: z.enum(['active', 'disabled']).optional(),
    settings: scimConnectionSettingsSchema.optional(),
  }),
  response: { mode: 'json', schema: z.object({ connection: scimConnectionSchema }) },
})

export const issueScimCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/scim/credentials',
  params: organizationParamsSchema,
  body: z.object({
    /** Days until the credential stops working. Omitted means it does not expire. */
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  }),
  response: {
    mode: 'json',
    /** `secret` appears here and nowhere else; only its digest is stored. */
    schema: z.object({ secret: z.string(), credential: scimCredentialSchema }),
    status: 201,
  },
})

export const revokeScimCredentialContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/scim/credentials/[credentialId]',
  params: organizationParamsSchema.extend({ credentialId: z.string().min(1).max(128) }),
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

const groupMappingSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupDisplayName: z.string(),
  targetKind: z.enum(['permission_group', 'workspace', 'org_role']),
  permissionGroupId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  permissionType: z.enum(['admin', 'write', 'read']).nullable(),
  role: z.string().nullable(),
})

export const listScimGroupMappingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/scim/mappings',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      groups: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          memberCount: z.number().int(),
          mappings: z.array(groupMappingSchema),
        })
      ),
    }),
  },
})

export const scimGroupMappingBodySchema = z.discriminatedUnion('targetKind', [
  z.object({
    groupId: z.string().min(1).max(128),
    targetKind: z.literal('permission_group'),
    permissionGroupId: z.string().min(1).max(128),
  }),
  z.object({
    groupId: z.string().min(1).max(128),
    targetKind: z.literal('workspace'),
    workspaceId: z.string().min(1).max(128),
    permissionType: z.enum(['admin', 'write', 'read']),
  }),
  z.object({
    groupId: z.string().min(1).max(128),
    targetKind: z.literal('org_role'),
    role: z.literal('admin'),
  }),
])

export const upsertScimGroupMappingContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/scim/mappings',
  params: organizationParamsSchema,
  body: scimGroupMappingBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ mapping: groupMappingSchema, reconciledUsers: z.number().int() }),
    status: 201,
  },
})

export const deleteScimGroupMappingContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/scim/mappings/[mappingId]',
  params: organizationParamsSchema.extend({ mappingId: z.string().min(1).max(128) }),
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), reconciledUsers: z.number().int() }),
  },
})

const scimActivityEntrySchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  scimType: z.string().nullable(),
  detail: z.string().nullable(),
  userAgent: z.string().nullable(),
  durationMs: z.number().int(),
  createdAt: z.string(),
})

export const listScimActivityContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/scim/activity',
  params: organizationParamsSchema,
  query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
  response: {
    mode: 'json',
    schema: z.object({ entries: z.array(scimActivityEntrySchema) }),
  },
})

export const reconcileScimConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/scim/reconcile',
  params: organizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      reconciledUsers: z.number().int(),
      grantsAdded: z.number().int(),
      grantsRemoved: z.number().int(),
    }),
  },
})

export type ScimGroupMappingBody = z.input<typeof scimGroupMappingBodySchema>
export type ScimActivityEntry = z.output<typeof scimActivityEntrySchema>
export type ScimConnectionView = z.output<typeof scimConnectionSchema>
export type ScimCredentialView = z.output<typeof scimCredentialSchema>
export type ScimGroupMappingView = z.output<typeof groupMappingSchema>
