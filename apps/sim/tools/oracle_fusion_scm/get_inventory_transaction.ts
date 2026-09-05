import {
  createOracleFusionScmOperationInput,
  ORACLE_FUSION_SCM_OAUTH_CONFIG,
  oracleFusionScmAuthParamFields,
  oracleFusionScmInventoryTransactionOutputProperties,
  oracleFusionScmOpaqueKeyParam,
} from '@/tools/oracle_fusion_scm/shared'
import type {
  OracleFusionScmDetailParams,
  OracleFusionScmDetailResponse,
} from '@/tools/oracle_fusion_scm/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

const params = {
  ...oracleFusionScmAuthParamFields,
  transactionKey: oracleFusionScmOpaqueKeyParam(
    'Oracle-derived transactionKey; preserve the key exactly'
  ),
} satisfies ToolConfig['params']

export const oracleFusionScmGetInventoryTransactionTool: InternalToolConfig<
  OracleFusionScmDetailParams<'transactionKey'>,
  OracleFusionScmDetailResponse<'transaction'>
> = {
  id: 'oracle_fusion_scm_get_inventory_transaction',
  name: 'Oracle Fusion SCM Get Inventory Transaction',
  description: 'Get one completed inventory transaction by its opaque Oracle resource key.',
  version: '1.0.0',
  params,
  oauth: ORACLE_FUSION_SCM_OAUTH_CONFIG,
  operation: {
    input: (input) => createOracleFusionScmOperationInput(input, params),
  },
  outputs: {
    transaction: {
      type: 'object',
      description: 'The inventory transaction returned by Oracle',
      properties: oracleFusionScmInventoryTransactionOutputProperties,
    },
  },
}
