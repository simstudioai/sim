import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRY_VALUES_OUTPUTS,
  type OracleFusionHcmListElementEntryValuesParams,
  type OracleFusionHcmListElementEntryValuesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListElementEntryValuesTool: InternalToolConfig<
  OracleFusionHcmListElementEntryValuesParams,
  OracleFusionHcmListElementEntryValuesResponse
> = {
  id: 'oracle_fusion_hcm_list_element_entry_values',
  name: 'List Element Entry Values in Oracle Fusion HCM',
  description:
    'Read one page of element entry values from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    elementEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Element entry ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRY_VALUES_OUTPUTS,
}
