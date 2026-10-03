import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateOpportunityParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateOpportunityTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateOpportunityParams>({
    id: 'oracle_fusion_sales_update_opportunity',
    operation: 'update_opportunity',
    name: 'Oracle Fusion Sales Update opportunity',
    description: 'Update opportunity in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: OPPORTUNITY_OUTPUT_PROPERTIES,
      },
    },
  })
