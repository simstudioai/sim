import { ZodError } from 'zod'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  executeOracleFusionScmConfirmQuickShipLines,
  executeOracleFusionScmCreateMaintenanceWorkOrder,
  executeOracleFusionScmCreateManufacturingWorkOrder,
  executeOracleFusionScmCreateSalesOrder,
  executeOracleFusionScmCreateSupplyRequest,
  executeOracleFusionScmDeleteSalesOrder,
  executeOracleFusionScmPickReleaseShipmentLines,
  executeOracleFusionScmReadOperation,
  executeOracleFusionScmUpdateItem,
  executeOracleFusionScmUpdateMaintenanceWorkOrder,
  executeOracleFusionScmUpdateManufacturingWorkOrder,
  executeOracleFusionScmUpdateSalesOrder,
  executeOracleFusionScmUpdateSupplyRequest,
  executeOracleFusionScmUpdateTransferOrder,
  executeOracleFusionScmUpdateTransferOrderLine,
  isOracleFusionScmReadToolId,
} from '@/lib/internal/oracle-fusion-scm/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleFusionScmTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  try {
    if (isOracleFusionScmReadToolId(toolId)) {
      return Response.json(await executeOracleFusionScmReadOperation(toolId, input, signal))
    }
    switch (toolId) {
      case 'oracle_fusion_scm_update_item':
        return Response.json(await executeOracleFusionScmUpdateItem(input, signal))
      case 'oracle_fusion_scm_create_supply_request':
        return Response.json(await executeOracleFusionScmCreateSupplyRequest(input, signal))
      case 'oracle_fusion_scm_update_supply_request':
        return Response.json(await executeOracleFusionScmUpdateSupplyRequest(input, signal))
      case 'oracle_fusion_scm_update_transfer_order':
        return Response.json(await executeOracleFusionScmUpdateTransferOrder(input, signal))
      case 'oracle_fusion_scm_update_transfer_order_line':
        return Response.json(await executeOracleFusionScmUpdateTransferOrderLine(input, signal))
      case 'oracle_fusion_scm_create_manufacturing_work_order':
        return Response.json(
          await executeOracleFusionScmCreateManufacturingWorkOrder(input, signal)
        )
      case 'oracle_fusion_scm_update_manufacturing_work_order':
        return Response.json(
          await executeOracleFusionScmUpdateManufacturingWorkOrder(input, signal)
        )
      case 'oracle_fusion_scm_create_maintenance_work_order':
        return Response.json(await executeOracleFusionScmCreateMaintenanceWorkOrder(input, signal))
      case 'oracle_fusion_scm_update_maintenance_work_order':
        return Response.json(await executeOracleFusionScmUpdateMaintenanceWorkOrder(input, signal))
      case 'oracle_fusion_scm_create_sales_order':
        return Response.json(await executeOracleFusionScmCreateSalesOrder(input, signal))
      case 'oracle_fusion_scm_update_sales_order':
        return Response.json(await executeOracleFusionScmUpdateSalesOrder(input, signal))
      case 'oracle_fusion_scm_delete_sales_order':
        return Response.json(await executeOracleFusionScmDeleteSalesOrder(input, signal))
      case 'oracle_fusion_scm_pick_release_shipment_lines':
        return Response.json(await executeOracleFusionScmPickReleaseShipmentLines(input, signal))
      case 'oracle_fusion_scm_confirm_quick_ship_lines':
        return Response.json(await executeOracleFusionScmConfirmQuickShipLines(input, signal))
      default:
        return Response.json(
          { success: false, output: {}, error: 'Unsupported Oracle Fusion SCM tool' },
          { status: 500 }
        )
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json(
        { success: false, output: {}, error: error.message },
        { status: error.status }
      )
    }
    const validationFailure = error instanceof ZodError
    return Response.json(
      {
        success: false,
        output: {},
        error: validationFailure
          ? 'Invalid Oracle Fusion SCM input'
          : 'Oracle Fusion SCM request failed',
      },
      { status: validationFailure ? 400 : 500 }
    )
  }
}
