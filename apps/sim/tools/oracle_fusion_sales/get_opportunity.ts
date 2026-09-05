import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesGetOpportunityParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetOpportunityTool =
  createOracleFusionSalesTool<OracleFusionSalesGetOpportunityParams>({
    id: 'oracle_fusion_sales_get_opportunity',
    operation: 'get_opportunity',
    name: 'Oracle Fusion Sales Get opportunity',
    description: 'Get opportunity in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: OPPORTUNITY_OUTPUT_PROPERTIES,
      },
    },
  })
