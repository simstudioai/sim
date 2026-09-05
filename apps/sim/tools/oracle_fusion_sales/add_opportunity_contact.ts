import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesAddOpportunityContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAddOpportunityContactTool =
  createOracleFusionSalesTool<OracleFusionSalesAddOpportunityContactParams>({
    id: 'oracle_fusion_sales_add_opportunity_contact',
    operation: 'add_opportunity_contact',
    name: 'Oracle Fusion Sales Add opportunity contact',
    description: 'Add opportunity contact in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
