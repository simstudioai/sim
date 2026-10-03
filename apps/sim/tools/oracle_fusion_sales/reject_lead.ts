import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRejectLeadParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesRejectLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesRejectLeadParams>({
    id: 'oracle_fusion_sales_reject_lead',
    operation: 'reject_lead',
    name: 'Oracle Fusion Sales Reject lead',
    description:
      'Reject lead using the Oracle rejectLead action. Returns the Oracle result string, not a record.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
