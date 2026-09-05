import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  type OracleFusionSalesListAccountsParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListAccountsTool =
  createOracleFusionSalesTool<OracleFusionSalesListAccountsParams>({
    id: 'oracle_fusion_sales_list_accounts',
    operation: 'list_accounts',
    name: 'Oracle Fusion Sales List accounts',
    description:
      'List one bounded page of accounts from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: ACCOUNT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
