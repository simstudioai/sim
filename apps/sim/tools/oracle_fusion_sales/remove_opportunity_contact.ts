import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRemoveOpportunityContactParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesRemoveOpportunityContactTool =
  createOracleFusionSalesTool<OracleFusionSalesRemoveOpportunityContactParams>({
    id: 'oracle_fusion_sales_remove_opportunity_contact',
    operation: 'remove_opportunity_contact',
    name: 'Oracle Fusion Sales Remove opportunity contact',
    description:
      'Remove opportunity contact in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
