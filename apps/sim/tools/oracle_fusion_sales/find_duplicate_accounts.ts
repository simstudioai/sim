import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  DUPLICATE_ACCOUNT_OUTPUT_PROPERTIES,
  type OracleFusionSalesFindDuplicateAccountsParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesFindDuplicateAccountsTool =
  createOracleFusionSalesTool<OracleFusionSalesFindDuplicateAccountsParams>({
    id: 'oracle_fusion_sales_find_duplicate_accounts',
    operation: 'find_duplicate_accounts',
    name: 'Oracle Fusion Sales Find duplicate accounts',
    description:
      'Find duplicate accounts using Oracle Data Quality matching. Returns candidate fields and scores without merging records. Results above the integration limit of 1,000 candidates fail explicitly; refine the matching fields.',
    outputs: {
      items: {
        type: 'array',
        description:
          'Duplicate candidates, limited to 1,000; oversized results fail without truncation',
        items: { type: 'object', properties: DUPLICATE_ACCOUNT_OUTPUT_PROPERTIES },
      },
      count: { type: 'number', description: 'Number of returned duplicate candidates' },
    },
  })
