import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesUpdateOpportunityRevenueParams,
  REVENUE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateOpportunityRevenueTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateOpportunityRevenueParams>({
    id: 'oracle_fusion_sales_update_opportunity_revenue',
    operation: 'update_opportunity_revenue',
    name: 'Oracle Fusion Sales Update opportunity revenue',
    description:
      'Update opportunity revenue in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: REVENUE_OUTPUT_PROPERTIES,
      },
    },
  })
