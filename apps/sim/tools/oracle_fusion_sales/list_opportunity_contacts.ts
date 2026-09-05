import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesListOpportunityContactsParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListOpportunityContactsTool =
  createOracleFusionSalesTool<OracleFusionSalesListOpportunityContactsParams>({
    id: 'oracle_fusion_sales_list_opportunity_contacts',
    operation: 'list_opportunity_contacts',
    name: 'Oracle Fusion Sales List opportunity contacts',
    description:
      'List one bounded page of opportunity contacts from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
