import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRIES_OUTPUTS,
  type OracleFusionHcmListElementEntriesParams,
  type OracleFusionHcmListElementEntriesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListElementEntriesTool: InternalToolConfig<
  OracleFusionHcmListElementEntriesParams,
  OracleFusionHcmListElementEntriesResponse
> = {
  id: 'oracle_fusion_hcm_list_element_entries',
  name: 'List Element Entries in Oracle Fusion HCM',
  description:
    'Read one page of element entries from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Worker person number, including any leading zeros; does not require current public-directory membership',
    },
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
    assignmentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HR assignment number',
    },
    elementTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Element type ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRIES_OUTPUTS,
}
