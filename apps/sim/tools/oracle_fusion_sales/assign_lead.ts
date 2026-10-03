import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesAssignLeadParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAssignLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesAssignLeadParams>({
    id: 'oracle_fusion_sales_assign_lead',
    operation: 'assign_lead',
    name: 'Oracle Fusion Sales Assign lead',
    description:
      'Assign lead using the Oracle runAssignment action. Returns the Oracle result string, not a record. Runs configured assignment; change a specific owner with the update tool.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
