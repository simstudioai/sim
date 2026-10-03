import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateOpportunityContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateOpportunityContactTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateOpportunityContactParams>({
    id: 'oracle_fusion_sales_update_opportunity_contact',
    operation: 'update_opportunity_contact',
    name: 'Oracle Fusion Sales Update opportunity contact',
    description:
      'Update opportunity contact in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
