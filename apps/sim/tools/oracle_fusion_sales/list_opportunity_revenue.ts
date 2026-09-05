import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesListOpportunityRevenueParams,
  PAGINATION_OUTPUTS,
  REVENUE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListOpportunityRevenueTool =
  createOracleFusionSalesTool<OracleFusionSalesListOpportunityRevenueParams>({
    id: 'oracle_fusion_sales_list_opportunity_revenue',
    operation: 'list_opportunity_revenue',
    name: 'Oracle Fusion Sales List opportunity revenue',
    description:
      'List one bounded page of opportunity revenue from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: REVENUE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
