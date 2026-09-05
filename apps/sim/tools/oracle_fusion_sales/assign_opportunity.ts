import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesAssignOpportunityParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAssignOpportunityTool =
  createOracleFusionSalesTool<OracleFusionSalesAssignOpportunityParams>({
    id: 'oracle_fusion_sales_assign_opportunity',
    operation: 'assign_opportunity',
    name: 'Oracle Fusion Sales Assign opportunity',
    description:
      'Assign opportunity using the Oracle assignOpportunity action. Returns the Oracle result string, not a record. Runs configured assignment; change a specific owner with the update tool.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
