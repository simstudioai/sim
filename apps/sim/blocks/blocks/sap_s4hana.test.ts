import { describe, expect, it } from 'vitest'
import { SapS4HanaBlock } from '@/blocks/blocks/sap_s4hana'
import type { BlockToolParamsContext } from '@/blocks/types'

const mapParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => SapS4HanaBlock.tools.config?.params?.(inputs, context) ?? {}

const items = [{ Material: 'M-1', RequestedQuantity: '1' }]

/** On an agent call the stored operation reaches the mapper only on `context`, never in the args. */
describe('SAP S/4HANA agent tool calls', () => {
  it('maps sales order items set on the tool to the items param', () => {
    expect(
      mapParams({ salesOrderItems: items }, { operation: 'sap_s4hana_create_sales_order' }).items
    ).toEqual(items)
  })

  it('keeps the model OData service, path and body when the tool fields are blank', () => {
    const mapped = mapParams(
      { service: 'API_PRODUCT_SRV', path: '/A_Product', method: 'POST', body: { Product: 'P1' } },
      { operation: 'sap_s4hana_odata_query' }
    )
    expect(mapped).toMatchObject({
      service: 'API_PRODUCT_SRV',
      path: '/A_Product',
      method: 'POST',
      body: { Product: 'P1' },
    })
  })

  it('maps canvas OData fields exactly as before', () => {
    const mapped = mapParams({
      operation: 'sap_s4hana_odata_query',
      odataService: 'API_PRODUCT_SRV',
      odataPath: '/A_Product',
    })
    expect(mapped).toMatchObject({ service: 'API_PRODUCT_SRV', path: '/A_Product', method: 'GET' })
  })
})
