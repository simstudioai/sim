import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesDeleteOpportunityRevenueParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesDeleteOpportunityRevenueTool =
  createOracleFusionSalesTool<OracleFusionSalesDeleteOpportunityRevenueParams>({
    id: 'oracle_fusion_sales_delete_opportunity_revenue',
    operation: 'delete_opportunity_revenue',
    name: 'Oracle Fusion Sales Delete opportunity revenue',
    description:
      'Delete opportunity revenue in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
