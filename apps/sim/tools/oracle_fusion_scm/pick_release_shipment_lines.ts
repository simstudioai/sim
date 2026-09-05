import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
} from '@/tools/oracle_fusion_scm/shared'
import type { OracleFusionScmMutationParams } from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig, ToolResponse } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  body: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object with details: a non-empty array (up to 100) of {"ShipmentLine":"123"}. ShipmentLine is a string, not a JSON number.',
  },
} satisfies ToolConfig['params']

export const oracleFusionScmPickReleaseShipmentLinesTool: InternalToolConfig<
  OracleFusionScmMutationParams,
  ToolResponse
> = {
  id: 'oracle_fusion_scm_pick_release_shipment_lines',
  name: 'Oracle Fusion SCM Pick Release Shipment Lines',
  description:
    'Submit the Release Pick Wave scheduled process for the specified shipment lines. Inspect Oracle processing results for business errors; HTTP success alone does not establish completion.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    result: {
      type: 'json',
      description:
        'Oracle dynamic processing-result map with string values. Inspect every entry for business errors.',
    },
  },
}
