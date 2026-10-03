import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmItemOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  itemKey: oracleFusionScmOpaqueKeyParam('Oracle-derived itemKey; preserve the key exactly'),
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object. Supported fields: ItemDescription, LongDescription, ItemStatusValue, LifecyclePhaseValue, PrimaryUOMValue, SecondaryUOMValue, InventoryItemFlag, StockEnabledFlag, ShippableFlag, BuildInWIPFlag, LotControlValue, SerialGenerationValue. Provide at least one field. Pass Oracle integer fields as decimal strings (including nested IDs); they are serialized exactly as JSON numbers on the server. Omit unchanged fields; use null only for nullable fields.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmUpdateItemTool: InternalToolConfig<
  OracleFusionScmMutationParams<'itemKey'>,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_update_item',
  name: 'Oracle Fusion SCM Update Item',
  description:
    'Update Item using documented Oracle fields. Oracle enforces tenant setup, permissions, and lifecycle restrictions.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    item: {
      type: 'object',
      description: 'The item returned by Oracle',
      properties: oracleFusionScmItemOutputProperties,
    },
  },
}
