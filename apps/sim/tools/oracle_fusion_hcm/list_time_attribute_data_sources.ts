import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_DATA_SOURCES_OUTPUTS,
  type OracleFusionHcmListTimeAttributeDataSourcesParams,
  type OracleFusionHcmListTimeAttributeDataSourcesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeAttributeDataSourcesTool: InternalToolConfig<
  OracleFusionHcmListTimeAttributeDataSourcesParams,
  OracleFusionHcmListTimeAttributeDataSourcesResponse
> = {
  id: 'oracle_fusion_hcm_list_time_attribute_data_sources',
  name: 'List Time Attribute Data Sources in Oracle Fusion HCM',
  description: 'Read one page of time attribute data sources from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    timeAttributeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time attribute ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_DATA_SOURCES_OUTPUTS,
}
