import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteOpportunityParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteOpportunityTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteOpportunityParams>({
    id: 'oracle_fusion_sales_delete_opportunity',
    operation: 'delete_opportunity',
    name: 'Oracle Fusion Sales Delete opportunity',
    description: 'Delete opportunity in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
