import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_ELEMENT_ENTRY_OUTPUTS,
  type OracleFusionHcmGetElementEntryParams,
  type OracleFusionHcmGetElementEntryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetElementEntryTool: InternalToolConfig<
  OracleFusionHcmGetElementEntryParams,
  OracleFusionHcmGetElementEntryResponse
> = {
  id: 'oracle_fusion_hcm_get_element_entry',
  name: 'Get Element Entry in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM element entry by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
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
  outputs: ORACLE_FUSION_HCM_GET_ELEMENT_ENTRY_OUTPUTS,
}
