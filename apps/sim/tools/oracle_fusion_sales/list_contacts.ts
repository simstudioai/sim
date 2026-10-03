import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesListContactsParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListContactsTool =
  createOracleFusionSalesTool<OracleFusionSalesListContactsParams>({
    id: 'oracle_fusion_sales_list_contacts',
    operation: 'list_contacts',
    name: 'Oracle Fusion Sales List contacts',
    description:
      'List one bounded page of contacts from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: CONTACT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
