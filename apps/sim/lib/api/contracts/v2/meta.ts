import { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse, v2TimestampSchema } from '@/lib/api/contracts/v2/shared'

export const v2ApiKeyTypeSchema = z
  .enum(['personal', 'workspace', 'oauth_access_token'])
  .describe(
    'Whether the calling credential is a personal API key carrying the full authority of its owner across their workspaces, a key scoped to one workspace, or an OAuth access token acting for its user within the scopes it was granted.'
  )
export type V2ApiKeyType = z.output<typeof v2ApiKeyTypeSchema>

/** Facts about the calling credential itself. Nothing here is workspace data. */
export const v2MetaSchema = z
  .object({
    v2Enabled: z
      .boolean()
      .describe('Whether this API version is available. This is true when the endpoint is served.'),
    keyType: v2ApiKeyTypeSchema,
    expiresAt: v2TimestampSchema
      .nullable()
      .describe(
        'ISO 8601 timestamp when the calling credential expires, or null when it does not.'
      ),
  })
  .meta({
    id: 'V2Meta',
    title: 'API capabilities',
    description: 'API availability and lifecycle facts about the calling credential.',
  })
export type V2Meta = z.output<typeof v2MetaSchema>

export const v2GetMetaContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/meta',
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2MetaSchema),
  },
})
