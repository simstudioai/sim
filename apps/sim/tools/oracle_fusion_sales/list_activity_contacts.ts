import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesListActivityContactsParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListActivityContactsTool =
  createOracleFusionSalesTool<OracleFusionSalesListActivityContactsParams>({
    id: 'oracle_fusion_sales_list_activity_contacts',
    operation: 'list_activity_contacts',
    name: 'Oracle Fusion Sales List activity contacts',
    description:
      'List one bounded page of activity contacts from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: ACTIVITY_CONTACT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
