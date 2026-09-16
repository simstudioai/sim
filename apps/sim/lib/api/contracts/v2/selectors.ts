import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { selectorContextSchema, selectorOptionSchema } from '@/lib/api/contracts/selectors/execute'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { type ServerSelectorKey, selectorManifest } from '@/lib/selectors/manifest'

const INTERNAL_CATALOG_SELECTORS = new Set([
  'workspace.credentialProviders',
  'workspace.rawSecretNames',
  'workspace.credentialGroupProviders',
  'workspace.organizationMcpProviders',
])

const workspaceSelectorKeys = Object.entries(selectorManifest)
  .filter(
    ([key, entry]) =>
      !INTERNAL_CATALOG_SELECTORS.has(key) &&
      entry.classification !== 'local' &&
      entry.scopeKinds.some((kind) => kind === 'workspace')
  )
  .map(([key]) => key as ServerSelectorKey)

export const v2SelectorInputSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Explicit current workspace scope.'),
    selectorKey: z
      .enum(workspaceSelectorKeys as [ServerSelectorKey, ...ServerSelectorKey[]])
      .describe('Selector key returned by an import or sync preview, for example gmail.labels.')
      .describe('Registered selector key for discovering this field’s destination options.'),
    context: selectorContextSchema
      .default({})
      .describe(
        'Only the dependencies declared by the selector, such as oauthCredential and channelId. Missing OAuth connections require human authorization.'
      ),
  })
  .strict()

export const v2ListSelectorBodySchema = v2SelectorInputSchema
  .extend({
    search: z.string().min(1).max(1024).optional().describe('Provider option search text.'),
    cursor: z
      .string()
      .min(1)
      .max(32 * 1024)
      .optional()
      .describe('Opaque continuation cursor returned by the preceding page.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum number of items to return on one page.'),
  })
  .strict()
export const v2GetSelectorBodySchema = v2SelectorInputSchema
  .extend({
    id: z
      .string()
      .min(1)
      .max(16 * 1024)
      .describe('Provider resource identifier to resolve.')
      .describe('Resource identifier.'),
  })
  .strict()

export const v2ListSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/selectors/list',
  query: noInputSchema,
  body: v2ListSelectorBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z
        .array(selectorOptionSchema)
        .max(100)
        .describe('Requested options or operation result.'),
      nextCursor: z
        .string()
        .max(32 * 1024)
        .nullable()
        .describe(
          'Opaque cursor for the next page. Send it back as `cursor`; null means there is nothing further to fetch. Never construct one yourself.'
        ),
      truncated: z
        .boolean()
        .describe('Whether the provider returned only a bounded subset of its options.'),
    }),
  },
})
export const v2GetSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/selectors/get',
  query: noInputSchema,
  body: v2GetSelectorBodySchema,
  response: { mode: 'json', schema: v2DataResponse(selectorOptionSchema.nullable()) },
})
export type V2ListSelectorBody = z.input<typeof v2ListSelectorBodySchema>
export type V2GetSelectorBody = z.input<typeof v2GetSelectorBodySchema>
export type V2ListSelectorResponse = z.output<typeof v2ListSelectorContract.response.schema>
export type V2GetSelectorResponse = z.output<typeof v2GetSelectorContract.response.schema>
