import type {
  ShopifyCancellationResult,
  ShopifyGetJobParams,
  ShopifyJobResponse,
} from '@/tools/shopify/types'
import { CANCELLATION_RESULT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl, readShopifyResult } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

/** Polls a legacy job or cancellation result, including asynchronous cancellation errors. */
export const shopifyGetJobTool: ToolConfig<ShopifyGetJobParams, ShopifyJobResponse> = {
  id: 'shopify_get_job',
  name: 'Shopify Get Job',
  description: 'Read Shopify job progress or the outcome and errors of an order cancellation',
  version: '1.0.0',
  oauth: { required: true, provider: 'shopify', authoritativeParams: ['domain', 'idToken'] },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    shopDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Shop domain supplied by the connected credential (store.myshopify.com)',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'jobResult.id (OrderCancelJobResult GID) for cancellation outcome, or a legacy Job GID',
    },
  },
  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.jobId?.trim()) throw new Error('Job ID is required')
      if (params.jobId.trim().startsWith('gid://shopify/OrderCancelJobResult/')) {
        return {
          query: `
          query getCancellationResult($id: ID!) {
            jobResult: node(id: $id) {
              ... on OrderCancelJobResult {
                id
                done
                status
                errors {
                  field
                  message
                  code
                }
                order {
                  id
                  cancelledAt
                }
              }
            }
          }

        `,
          variables: { id: params.jobId.trim() },
        }
      }
      return {
        query: `
          query getJob($id: ID!) {
            job(id: $id) {
              id
              done
            }
          }

        `,
        variables: { id: params.jobId.trim() },
      }
    },
  },
  transformResponse: async (response, params) => {
    if (params?.jobId?.trim().startsWith('gid://shopify/OrderCancelJobResult/')) {
      const jobResult = await readShopifyResult<ShopifyCancellationResult>(response, 'jobResult')
      if (!jobResult.id) throw new Error('Shopify returned no cancellation result')
      return { success: true, output: { jobResult } }
    }
    const job = await readShopifyResult<{ id: string; done: boolean }>(response, 'job')
    return { success: true, output: { job } }
  },
  outputs: {
    jobResult: {
      type: 'object',
      optional: true,
      description: 'Cancellation outcome when using an OrderCancelJobResult ID',
      properties: CANCELLATION_RESULT_OUTPUT_PROPERTIES,
    },
    job: {
      type: 'object',
      optional: true,
      description: 'Asynchronous job status',
      properties: {
        id: { type: 'string', description: 'Job GID' },
        done: {
          type: 'boolean',
          description: 'Whether processing ran; inspect cancellation result for success',
        },
      },
    },
  },
}
