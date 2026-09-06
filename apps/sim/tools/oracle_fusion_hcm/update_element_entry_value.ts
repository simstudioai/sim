import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_UPDATE_ELEMENT_ENTRY_VALUE_OUTPUTS,
  type OracleFusionHcmUpdateElementEntryValueParams,
  type OracleFusionHcmUpdateElementEntryValueResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmUpdateElementEntryValueTool: InternalToolConfig<
  OracleFusionHcmUpdateElementEntryValueParams,
  OracleFusionHcmUpdateElementEntryValueResponse
> = {
  id: 'oracle_fusion_hcm_update_element_entry_value',
  name: 'Update Element Entry Value in Oracle Fusion HCM',
  description:
    'Update Element Entry Value using documented Oracle fields. Requires administrative privileges and valid tenant configuration.',
  ...internalExecution,
  params: {
    ...common,
    elementEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Element entry ID, as a positive decimal string',
    },
    elementEntryValueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Element entry value ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
    rangeMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CORRECTION changes the historical row; UPDATE starts an effective-dated change',
    },
    // Like Ashby's nullable fieldValue, the key is required by the operation
    // schema, not the shared validator, which treats explicit null as missing.
    screenEntryValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Element input value as text, preserving decimal precision; null clears a nullable value',
    },
  },
  outputs: ORACLE_FUSION_HCM_UPDATE_ELEMENT_ENTRY_VALUE_OUTPUTS,
}
