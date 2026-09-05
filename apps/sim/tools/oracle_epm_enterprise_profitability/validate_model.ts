import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmResponse,
  OracleEpcmValidateModelParams,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmValidateModelTool: InternalToolConfig<
  OracleEpcmValidateModelParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_validate_model',
  name: 'Oracle EPCM Validate Model',
  description:
    'Submit validation of an existing EPCM model; retain the job ID and download the named validation file after completion.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    applicationName: {
      type: 'string',
      required: true,
      description: 'Exact EPCM application name',
      visibility: 'user-or-llm',
    },
    jobName: {
      type: 'string',
      required: true,
      description: 'Calculation/report/POV job label; an existing saved job is not required',
      visibility: 'user-or-llm',
    },
    modelName: {
      type: 'string',
      required: true,
      description: "Existing EPCM model name; use the tenant's exact name",
      visibility: 'user-or-llm',
    },
    fileName: {
      type: 'string',
      required: true,
      description: 'Validation results filename in the repository',
      visibility: 'user-or-llm',
    },
    ruleStatus: {
      type: 'string',
      required: false,
      description:
        "Rules to validate; uses Oracle's parameter-table casing. Allowed values: All, Enabled, Disabled.",
      default: 'All',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
