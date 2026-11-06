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
      .describe('Registered selector key from an import or sync preview, such as `gmail.labels`.'),
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
      .describe(
        'Cursor returned by the preceding page. Keep `workspaceId`, `selectorKey`, `context`, and `search` unchanged; only `limit` may change. Restart without a cursor after a changed-page 409.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum options per page, from 1 to 100. Defaults to 50.'),
  })
  .strict()
export const v2GetSelectorBodySchema = v2SelectorInputSchema
  .extend({
    id: z
      .string()
      .min(1)
      .max(16 * 1024)
      .describe('Provider option ID to resolve with the same selector and declared context.'),
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
        .describe('Authorized provider options in this page.'),
      nextCursor: z
        .string()
        .max(32 * 1024)
        .nullable()
        .describe(
          'Opaque cursor for the next page. Send it back as `cursor`; null means there is nothing further to fetch. Never construct one yourself.'
        ),
      truncated: z
        .boolean()
        .describe(
          'Whether provider limits left the result incomplete. A null `nextCursor` with `truncated: true` does not establish that all options were searched.'
        ),
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
