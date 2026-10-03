import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateOpportunityParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateOpportunityTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateOpportunityParams>({
    id: 'oracle_fusion_sales_create_opportunity',
    operation: 'create_opportunity',
    name: 'Oracle Fusion Sales Create opportunity',
    description: 'Create opportunity in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: OPPORTUNITY_OUTPUT_PROPERTIES,
      },
    },
  })
