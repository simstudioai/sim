import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  type OracleFusionSalesCreateOpportunityRevenueParams,
  REVENUE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateOpportunityRevenueTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateOpportunityRevenueParams>({
    id: 'oracle_fusion_sales_create_opportunity_revenue',
    operation: 'create_opportunity_revenue',
    name: 'Oracle Fusion Sales Create opportunity revenue',
    description:
      'Create opportunity revenue in Oracle Fusion Sales using documented CRM REST fields. Provide productGroupId or both inventoryItemId and inventoryOrganizationId.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: REVENUE_OUTPUT_PROPERTIES,
      },
    },
  })
