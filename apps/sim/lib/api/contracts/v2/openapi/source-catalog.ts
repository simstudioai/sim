import { z } from 'zod'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetSourceCatalogContract } from '@/lib/api/contracts/v2/source-catalog'
import { defineOpenApiRoute, type OpenApiHeader } from '@/lib/api/openapi/types'

/** Response headers only the source catalog sends, for the document that publishes it. */
export const SOURCE_CATALOG_HEADERS = {
  ETag: {
    schema: z.string().min(1).meta({
      id: 'ETagHeader',
      title: 'Entity tag',
      description:
        'The catalog `hash`, quoted. Send it back in `If-None-Match` to revalidate the catalog.',
    }),
  },
} as const satisfies Readonly<Record<string, OpenApiHeader>>

import { workflowOperations } from '@/lib/workflows/application/operations'

const BLOCK_CATALOG_EXAMPLE = {
  catalogVersion: 1,
  hash: '3f0c1a9e5b7d2c4f6a8e0b1d3c5f7a9e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a',
  sdkMajor: 1,
  blocks: {
    slack_v2: {
      type: 'slack_v2',
      name: 'Slack',
      category: 'tools',
      subBlocks: [
        {
          id: 'operation',
          type: 'dropdown',
          valueKind: 'string',
          storage: 'native',
          options: [{ id: 'send', label: 'Send Message' }],
        },
      ],
      tools: { access: ['slack_message'], selector: 'operation' },
      outputs: { ts: { type: 'string', description: 'Message timestamp' } },
      graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    },
  },
  triggers: {},
  builders: { 'slack.sendMessage': { type: 'slack_v2', operation: 'send' } },
}

export const sourceCatalogOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetSourceCatalogContract,
    {
      applicationOperation: workflowOperations.readSourceCatalog,
      operationId: 'getSourceCatalog',
      summary: 'Get source catalog',
      description:
        'Get the source catalog, the block catalog that workflow source is compiled and type-checked against: every block type the caller may place in the workspace, with its fields, visibility conditions, outputs, triggers, and SDK builder names. Pass `workflowId` to add the block types already placed in that workflow. The response carries the catalog `hash` as an `ETag`; send it back in `If-None-Match` to receive `304 Not Modified` with no body when the catalog is unchanged. Returns `403` while workflows as code is not enabled.',
      tags: ['Catalog'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The source catalog.',
        headers: ['ETag', ...RATE_LIMIT_HEADERS],
        notModified: {
          description:
            'The caller already holds the current catalog: `If-None-Match` names the current `ETag`. The response has no body.',
          headers: ['ETag'],
        },
      },
    },
    {
      params: documentedSchema(
        v2GetSourceCatalogContract.params,
        'GetSourceCatalogParams',
        'Get source catalog path parameters',
        'Workspace whose block availability is applied.'
      ),
      query: documentedSchema(
        v2GetSourceCatalogContract.query,
        'GetSourceCatalogQuery',
        'Get source catalog query',
        'Optional workflow whose placed block types are added.'
      ),
      headers: documentedSchema(
        v2GetSourceCatalogContract.headers,
        'GetSourceCatalogHeaders',
        'Get source catalog headers',
        'Conditional request header.'
      ),
      response: documentedSchema(
        v2GetSourceCatalogContract.response.schema,
        'GetSourceCatalogResponse',
        'Get source catalog response',
        'The source catalog core shard.',
        [{ data: BLOCK_CATALOG_EXAMPLE }]
      ),
    }
  ),
]
