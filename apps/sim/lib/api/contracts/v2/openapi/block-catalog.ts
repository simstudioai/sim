import { v2GetBlockCatalogContract } from '@/lib/api/contracts/v2/block-catalog'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workflowCodeCatalogOperations } from '@/lib/workflows/code/catalog/operations'

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
      inputs: {},
      outputs: { ts: { type: 'string', description: 'Message timestamp' } },
      graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    },
  },
  triggers: {},
  builders: { 'slack.sendMessage': { type: 'slack_v2', operation: 'send' } },
}

export const blockCatalogOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetBlockCatalogContract,
    {
      applicationOperation: workflowCodeCatalogOperations.read,
      operationId: 'getBlockCatalog',
      summary: 'Get block catalog',
      description:
        'Get the block catalog that workflow source is compiled and type-checked against: every block type the caller may place in the workspace, with its fields, visibility conditions, outputs, triggers, and SDK builder names. Pass `workflowId` to add the block types already placed in that workflow. The response carries the catalog `hash` as an `ETag`; send it back in `If-None-Match` to receive `304 Not Modified` with no body when the catalog is unchanged. Returns `403` while code-first workflows are not enabled.',
      tags: ['Catalog'],
      errors: RESOURCE_ERRORS,
      success: { description: 'The block catalog.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetBlockCatalogContract.params,
        'GetBlockCatalogParams',
        'Get block catalog path parameters',
        'Workspace whose block availability is applied.'
      ),
      query: documentedSchema(
        v2GetBlockCatalogContract.query,
        'GetBlockCatalogQuery',
        'Get block catalog query',
        'Optional workflow whose placed block types are added.'
      ),
      headers: documentedSchema(
        v2GetBlockCatalogContract.headers,
        'GetBlockCatalogHeaders',
        'Get block catalog headers',
        'Conditional request header.'
      ),
      response: documentedSchema(
        v2GetBlockCatalogContract.response.schema,
        'GetBlockCatalogResponse',
        'Get block catalog response',
        'The block catalog core shard.',
        [{ data: BLOCK_CATALOG_EXAMPLE }]
      ),
    }
  ),
]
