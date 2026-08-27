/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SAP_S4HANA_TOOL_IDS } from '@/lib/internal/sap-s4hana/execute-tool'
import {
  getInternalToolOperationHandler,
  isInternalToolOperationRegistered,
} from '@/lib/internal/tool-operations/registry.server'
import * as sapTools from '@/tools/sap_s4hana'
import { getSalesOrderTool } from '@/tools/sap_s4hana/get_sales_order'
import { odataQueryTool } from '@/tools/sap_s4hana/odata_query'

describe('SAP S/4HANA tool operation inputs', () => {
  it('declares every family tool as operation-only with a registered canonical ID', () => {
    const tools = Object.values(sapTools)
    expect(tools).toHaveLength(38)
    expect(tools.map((tool) => tool.id).sort()).toEqual([...SAP_S4HANA_TOOL_IDS].sort())
    for (const tool of tools) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
      expect(isInternalToolOperationRegistered(tool.id)).toBe(true)
    }
  })

  it('loads the SAP S/4HANA family handler from the operation registry', async () => {
    await expect(getInternalToolOperationHandler(SAP_S4HANA_TOOL_IDS[0])).resolves.toBeTypeOf(
      'function'
    )
  })

  it('maps a dedicated entity read to the canonical service operation', () => {
    expect(
      getSalesOrderTool.operation.input({
        subdomain: 'example',
        region: 'us30',
        clientId: 'client',
        clientSecret: 'secret',
        salesOrder: "10'20",
      })
    ).toEqual({
      subdomain: 'example',
      region: 'us30',
      clientId: 'client',
      clientSecret: 'secret',
      service: 'API_SALES_ORDER_SRV',
      path: "/A_SalesOrder('10''20')",
      method: 'GET',
      query: { $format: 'json' },
    })
  })

  it('normalizes the generic OData query without HTTP transport metadata', () => {
    expect(
      odataQueryTool.operation.input({
        subdomain: 'example',
        region: 'us30',
        clientId: 'client',
        clientSecret: 'secret',
        service: 'API_PRODUCT_SRV',
        path: '/A_Product',
        query: '$top=5&$select=Product',
      })
    ).toEqual({
      subdomain: 'example',
      region: 'us30',
      clientId: 'client',
      clientSecret: 'secret',
      service: 'API_PRODUCT_SRV',
      path: '/A_Product',
      method: 'GET',
      query: { $top: '5', $select: 'Product', $format: 'json' },
    })
  })
})
