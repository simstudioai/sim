import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  DUPLICATE_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesFindDuplicateContactsParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesFindDuplicateContactsTool =
  createOracleFusionSalesTool<OracleFusionSalesFindDuplicateContactsParams>({
    id: 'oracle_fusion_sales_find_duplicate_contacts',
    operation: 'find_duplicate_contacts',
    name: 'Oracle Fusion Sales Find duplicate contacts',
    description:
      'Find duplicate contacts using Oracle Data Quality matching. Returns candidate fields and scores without merging records. Results above the integration limit of 1,000 candidates fail explicitly; refine the matching fields.',
    outputs: {
      items: {
        type: 'array',
        description:
          'Duplicate candidates, limited to 1,000; oversized results fail without truncation',
        items: { type: 'object', properties: DUPLICATE_CONTACT_OUTPUT_PROPERTIES },
      },
      count: { type: 'number', description: 'Number of returned duplicate candidates' },
    },
  })
