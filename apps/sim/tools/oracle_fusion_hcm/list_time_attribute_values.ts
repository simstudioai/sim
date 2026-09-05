import { listCommon, internalExecution, finderBindingItems } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_VALUES_OUTPUTS,
  type OracleFusionHcmListTimeAttributeValuesParams,
  type OracleFusionHcmListTimeAttributeValuesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeAttributeValuesTool: InternalToolConfig<
  OracleFusionHcmListTimeAttributeValuesParams,
  OracleFusionHcmListTimeAttributeValuesResponse
> = {
  id: 'oracle_fusion_hcm_list_time_attribute_values',
  name: 'List Time Attribute Values in Oracle Fusion HCM',
  description: 'Read one page of time attribute values from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    dataSourceUsageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data source usage ID, as a positive decimal string',
    },
    timeAttributeUsageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time attribute usage ID, as a positive decimal string',
    },
    bindings: {
      type: 'array',
      items: finderBindingItems,
      minItems: 0,
      maxItems: 5,
      required: false,
      visibility: 'user-or-llm',
      description: 'Up to five typed {name, value} bindings from list_time_attribute_criteria_binds; values cannot contain finder separators',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_VALUES_OUTPUTS,
}
