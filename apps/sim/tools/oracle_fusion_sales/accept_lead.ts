import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesAcceptLeadParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAcceptLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesAcceptLeadParams>({
    id: 'oracle_fusion_sales_accept_lead',
    operation: 'accept_lead',
    name: 'Oracle Fusion Sales Accept lead',
    description:
      'Accept lead using the Oracle acceptLead action. Returns the Oracle result string, not a record.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
