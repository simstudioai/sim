import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

const params = z.object({ id: organizationIdSchema })
const path = '/api/organizations/[id]/people/sync'

/** Credentials used to read the organization's directory on a schedule. */
export const peopleSyncConfigSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('okta'),
      domain: z.string().trim().min(1).max(255),
      token: z
        .string()
        .trim()
        .min(1)
        .max(32_768)
        .regex(/^[!-~]+$/, 'Enter a valid API token'),
    })
    .strict(),
  z
    .object({
      source: z.literal('entra'),
      tenantId: z.guid({ error: 'Enter a valid directory (tenant) ID.' }),
      clientId: z.guid({ error: 'Enter a valid application (client) ID.' }),
      clientSecret: z.string().trim().min(1).max(8192),
    })
    .strict(),
  z.object({ source: z.literal('scim') }).strict(),
])
export type PeopleSyncConfig = z.infer<typeof peopleSyncConfigSchema>

const status = z.object({
  source: z.enum(['okta', 'entra', 'scim']),
  state: z.enum(['scheduled', 'syncing', 'failed', 'queued', 'paused']),
  domain: z.string().optional(),
  tenantId: z.string().optional(),
  clientId: z.string().optional(),
  lastAttemptAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastFailedAt: z.iso.datetime().nullable(),
  nextSyncAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  progress: z
    .object({
      phase: z.enum(['users', 'relationships', 'publish']),
      usersRead: z.number().int().nonnegative(),
    })
    .nullable(),
  retryAt: z.iso.datetime().nullable(),
  retryBlocked: z.boolean(),
})
export type PeopleSyncStatus = z.infer<typeof status>

export const getPeopleSyncContract = defineRouteContract({
  method: 'GET',
  path,
  params,
  response: { mode: 'json', schema: z.object({ sync: status.nullable() }) },
})
export const configurePeopleSyncContract = defineRouteContract({
  method: 'PUT',
  path,
  params,
  body: peopleSyncConfigSchema,
  response: { mode: 'json', schema: z.object({ sync: status }) },
})
export const runPeopleSyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/people/sync/run',
  params,
  response: { mode: 'json', schema: z.object({ sync: status }) },
})
export const disconnectPeopleSyncContract = defineRouteContract({
  method: 'DELETE',
  path,
  params,
  response: { mode: 'json', schema: z.object({ sync: z.null() }) },
})
