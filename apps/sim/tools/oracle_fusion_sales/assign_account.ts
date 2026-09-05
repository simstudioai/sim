import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesAssignAccountParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAssignAccountTool =
  createOracleFusionSalesTool<OracleFusionSalesAssignAccountParams>({
    id: 'oracle_fusion_sales_assign_account',
    operation: 'assign_account',
    name: 'Oracle Fusion Sales Assign account',
    description:
      'Assign account using the Oracle runAssignment action. Returns the Oracle result string, not a record. Runs configured assignment; change a specific owner with the update tool.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Oracle action result; inspect this status rather than assuming business success',
      },
    },
  })
