import { toError } from '@sim/utils/errors'
import {
  executeSapS4HanaOperation,
  SapS4HanaProviderError,
} from '@/lib/internal/sap-s4hana/operations'
import { sapS4HanaOperationInputSchema } from '@/lib/internal/sap-s4hana/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const SAP_S4HANA_TOOL_IDS = [
  'sap_s4hana_create_business_partner',
  'sap_s4hana_create_purchase_order',
  'sap_s4hana_create_purchase_requisition',
  'sap_s4hana_create_sales_order',
  'sap_s4hana_delete_sales_order',
  'sap_s4hana_get_billing_document',
  'sap_s4hana_get_business_partner',
  'sap_s4hana_get_customer',
  'sap_s4hana_get_inbound_delivery',
  'sap_s4hana_get_material_document',
  'sap_s4hana_get_outbound_delivery',
  'sap_s4hana_get_product',
  'sap_s4hana_get_purchase_order',
  'sap_s4hana_get_purchase_requisition',
  'sap_s4hana_get_sales_order',
  'sap_s4hana_get_supplier',
  'sap_s4hana_get_supplier_invoice',
  'sap_s4hana_list_billing_documents',
  'sap_s4hana_list_business_partners',
  'sap_s4hana_list_customers',
  'sap_s4hana_list_inbound_deliveries',
  'sap_s4hana_list_material_documents',
  'sap_s4hana_list_material_stock',
  'sap_s4hana_list_outbound_deliveries',
  'sap_s4hana_list_products',
  'sap_s4hana_list_purchase_orders',
  'sap_s4hana_list_purchase_requisitions',
  'sap_s4hana_list_sales_orders',
  'sap_s4hana_list_supplier_invoices',
  'sap_s4hana_list_suppliers',
  'sap_s4hana_odata_query',
  'sap_s4hana_update_business_partner',
  'sap_s4hana_update_customer',
  'sap_s4hana_update_product',
  'sap_s4hana_update_purchase_order',
  'sap_s4hana_update_purchase_requisition',
  'sap_s4hana_update_sales_order',
  'sap_s4hana_update_supplier',
] as const

const SAP_S4HANA_TOOL_ID_SET = new Set<string>(SAP_S4HANA_TOOL_IDS)

export const executeSapS4HanaTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  requestId,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!SAP_S4HANA_TOOL_ID_SET.has(toolId)) {
    return Response.json({ error: `Unsupported SAP S/4HANA tool: ${toolId}` }, { status: 500 })
  }

  const parsed = sapS4HanaOperationInputSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
      },
      { status: 400 }
    )
  }

  try {
    return Response.json(await executeSapS4HanaOperation(parsed.data, requestId, signal))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof SapS4HanaProviderError) {
      return Response.json(
        { success: false, error: error.message, status: error.status },
        { status: error.status }
      )
    }
    return Response.json({ success: false, error: toError(error).message }, { status: 500 })
  }
}
