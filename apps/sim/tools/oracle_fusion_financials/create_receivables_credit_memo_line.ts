import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  oracleFusionFinancialsAuthParamFields,
  oracleFusionReceivablesCreditMemoLineOutputProperties,
} from '@/tools/oracle_fusion_financials/shared'
import type {
  OracleFusionFinancialsCreateReceivablesCreditMemoLineParams,
  OracleFusionFinancialsDetailResponse,
} from '@/tools/oracle_fusion_financials/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionFinancialsCreateReceivablesCreditMemoLineTool: InternalToolConfig<
  OracleFusionFinancialsCreateReceivablesCreditMemoLineParams,
  OracleFusionFinancialsDetailResponse<'receivablesCreditMemoLine'>
> = {
  id: 'oracle_fusion_financials_create_receivables_credit_memo_line',
  name: 'Oracle Fusion Financials Create Receivables Credit Memo Line',
  description: 'Create Oracle Fusion receivables credit memo line.',
  version: '1.0.0',
  params: {
    ...oracleFusionFinancialsAuthParamFields,
    receivablesCreditMemoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'receivables Credit Memo Id (exact decimal resource identifier)',
    },
    lineNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Line Number',
    },
    lineDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Description',
    },
    itemNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Item Number',
    },
    memoLine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memo Line',
    },
    lineAmountCredit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Amount Credit',
    },
    lineQuantityCredit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Quantity Credit',
    },
    unitSellingPrice: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit Selling Price',
    },
    unitOfMeasure: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit Of Measure',
    },
    lineCreditReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Credit Reason',
    },
    lineFreightCreditAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line Freight Credit Amount',
    },
    taxClassificationCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tax Classification Code',
    },
  },
  oauth: ORACLE_FUSION_FINANCIALS_OAUTH_CONFIG,
  operation: { input: createInternalToolOperationInput },
  outputs: {
    receivablesCreditMemoLine: {
      type: 'json',
      description: 'Projected receivables credit memo line',
      properties: oracleFusionReceivablesCreditMemoLineOutputProperties,
    },
  },
}
