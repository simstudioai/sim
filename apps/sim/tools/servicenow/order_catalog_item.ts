import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowOrderCatalogItemParams,
  ServiceNowOrderCatalogItemResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  readString,
  toRecordObject,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const orderCatalogItemTool: ToolConfig<
  ServiceNowOrderCatalogItemParams,
  ServiceNowOrderCatalogItemResponse
> = {
  id: 'servicenow_order_catalog_item',
  name: 'Order ServiceNow Catalog Item',
  description:
    'Submit a service catalog request for a catalog item using the Service Catalog API order_now endpoint. Returns the generated request number and sys_id.',
  version: '1.0.0',

  params: {
    ...authParams,
    catalogItemSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'sys_id of the catalog item to order. Use List ServiceNow Catalog Items to find it.',
    },
    quantity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quantity to order. Must not be negative. Defaults to 1.',
    },
    requestedFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'sys_id of the sys_user the item is ordered for. Ordering on behalf of another user is governed by the glide.sc.req_for.roles instance properties.',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name-value pairs for the catalog item variables, as a JSON object (e.g., {"data_plan": "500MB"}). All variables the item marks mandatory must be supplied.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const itemSysId = params.catalogItemSysId?.trim()
      if (!itemSysId) {
        throw new Error('A catalog item sys_id is required')
      }
      return `${baseUrl}/api/sn_sc/servicecatalog/items/${itemSysId}/order_now`
    },
    method: 'POST',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      let variables: Record<string, unknown> | undefined
      if (typeof params.variables === 'string' && params.variables.trim()) {
        const parsed = JSON.parse(params.variables)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('variables must be a JSON object')
        }
        variables = parsed as Record<string, unknown>
      } else if (params.variables && typeof params.variables === 'object') {
        variables = params.variables as Record<string, unknown>
      }

      const body: Record<string, unknown> = {
        sysparm_quantity: params.quantity ?? 1,
      }
      if (params.requestedFor) body.sysparm_requested_for = params.requestedFor
      if (variables) body.variables = variables
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const result = toRecordObject(data.result)

    return {
      success: true,
      output: {
        sysId: readString(result, 'sys_id'),
        number: readString(result, 'number'),
        requestNumber: readString(result, 'request_number'),
        requestId: readString(result, 'request_id'),
        table: readString(result, 'table'),
      },
    }
  },

  outputs: {
    sysId: { type: 'string', description: 'Sys_id of the order', nullable: true },
    number: { type: 'string', description: 'Number of the generated request', nullable: true },
    requestNumber: { type: 'string', description: 'Request number', nullable: true },
    requestId: { type: 'string', description: 'Sys_id of the order request', nullable: true },
    table: { type: 'string', description: 'Table name of the request', nullable: true },
  },
}
