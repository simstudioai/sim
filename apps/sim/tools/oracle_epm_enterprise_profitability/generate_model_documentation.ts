import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmGenerateModelDocumentationParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmGenerateModelDocumentationTool: InternalToolConfig<
  OracleEpcmGenerateModelDocumentationParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_generate_model_documentation',
  name: 'Oracle EPCM Generate Model Documentation',
  description:
    'Submit documentation generation for an existing EPCM model and its rules. Wait for the job before downloading the report.',
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
      description: 'Output report filename in the repository',
      visibility: 'user-or-llm',
    },
    outputType: {
      type: 'string',
      required: false,
      description: 'Report output format. Allowed values: PDF, Word, Excel, HTML, XML.',
      default: 'PDF',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
