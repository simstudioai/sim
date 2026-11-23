import { z } from 'zod'
import {
  connectorPermissionConfigSchema,
  connectorPermissionSummarySchema,
} from '@/lib/api/contracts/knowledge/connector-permissions'
import {
  noInputSchema,
  nonEmptyIdSchema,
  organizationIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CreateKnowledgeConnectorBodySchema,
  v2KnowledgeConnectorSchema,
  v2ListKnowledgeConnectorsQuerySchema,
} from '@/lib/api/contracts/v2/knowledge'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

const collectionPath = '/api/v2/organizations/[organizationId]/search/sources'
const organizationParams = z.strictObject({
  organizationId: organizationIdSchema.describe('Organization identifier.'),
})
const sourceParams = organizationParams.extend({
  sourceId: nonEmptyIdSchema.describe('Search source identifier, also used by permission uploads.'),
})
const accessMode = z
  .enum(['admin', 'members'])
  .describe(
    'Source-managed permissions (admin), or individually connected member accounts (members).'
  )
const apiKey = v2CreateKnowledgeConnectorBodySchema.shape.apiKey
const sourceConfig = v2CreateKnowledgeConnectorBodySchema.shape.sourceConfig

export const v2SearchSourceSchema = v2KnowledgeConnectorSchema
  .pick({
    id: true,
    connectorType: true,
    credentialId: true,
    sourceConfig: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    accessMode,
    approved: z
      .boolean()
      .describe(
        'Whether the organization has approved this integration. Approval is independent of source status.'
      ),
    permissionConfig: connectorPermissionSummarySchema
      .nullable()
      .describe('Permission revision and file summaries, without CSV contents.'),
  })

export const v2PrepareSearchSourcesContract = defineRouteContract({
  method: 'POST',
  path: `${collectionPath}/prepare`,
  params: organizationParams,
  query: noInputSchema,
  body: z.strictObject({
    connectorType: v2CreateKnowledgeConnectorBodySchema.shape.connectorType,
    accessMode: accessMode.default('admin'),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.strictObject({
        ready: z
          .literal(true)
          .describe('Shared Search configuration is ready for source creation.'),
      })
    ),
  },
})

export const v2ListSearchSourcesContract = defineRouteContract({
  method: 'GET',
  path: collectionPath,
  params: organizationParams,
  query: v2ListKnowledgeConnectorsQuerySchema.omit({ workspaceId: true }),
  response: { mode: 'json', schema: v2CursorListResponse(v2SearchSourceSchema) },
})

export const v2GetSearchSourceContract = defineRouteContract({
  method: 'GET',
  path: `${collectionPath}/[sourceId]`,
  params: sourceParams,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2SearchSourceSchema) },
})

export const v2CreateSearchSourceContract = defineRouteContract({
  method: 'POST',
  path: collectionPath,
  params: organizationParams,
  query: noInputSchema,
  body: v2CreateKnowledgeConnectorBodySchema
    .omit({ workspaceId: true, syncIntervalMinutes: true })
    .extend({
      accessMode: accessMode.default('admin'),
      permissionConfig: connectorPermissionConfigSchema
        .optional()
        .describe(
          'Provider-specific permissions for initial setup. Large CSV snapshots use permission imports after creation.'
        ),
    }),
  response: { mode: 'json', status: 201, schema: v2DataResponse(v2SearchSourceSchema) },
})

export const v2UpdateSearchSourceContract = defineRouteContract({
  method: 'PATCH',
  path: `${collectionPath}/[sourceId]`,
  params: sourceParams,
  query: noInputSchema,
  body: z
    .strictObject({
      apiKey: apiKey.describe(
        'Replacement token for providers supporting credential updates (currently GitLab). For GitLab, supply permissionConfig with the current expectedRevision; omitted CSVs retain grants. Omit to keep the saved token.'
      ),
      sourceConfig: sourceConfig
        .optional()
        .describe(
          'Complete replacement source configuration. Read the existing configuration before editing it.'
        ),
      permissionConfig: connectorPermissionConfigSchema
        .optional()
        .describe(
          'Provider-specific permission update, using the current expectedRevision. Omit to retain permissions.'
        ),
      status: z
        .enum(['active', 'paused'])
        .optional()
        .describe('Pause or resume this source without changing its ID or stored permissions.'),
    })
    .refine(
      (body) => Object.values(body).some((value) => value !== undefined),
      'Provide at least one of apiKey, sourceConfig, permissionConfig, or status.'
    ),
  response: { mode: 'json', schema: v2DataResponse(v2SearchSourceSchema) },
})

export const v2DeleteSearchSourceContract = defineRouteContract({
  method: 'DELETE',
  path: `${collectionPath}/[sourceId]`,
  params: sourceParams,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.strictObject({
        id: z.string().describe('Deleted Search source identifier.'),
        deleted: z
          .literal(true)
          .describe('The source was removed; permission cleanup continues asynchronously.'),
      })
    ),
  },
})
