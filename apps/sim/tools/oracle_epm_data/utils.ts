import type { OAuthConfig, ToolConfig } from '@/tools/types'

/** The existing foundation credential owns the origin and Basic authentication material. */
export const oracleEpmDataOAuth = {
  required: true,
  provider: 'oracle-epm-data',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const oracleEpmDataAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle EPM reusable service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authentication material injected from the selected Oracle EPM credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authoritative REST base URL injected from the selected Oracle EPM credential',
  },
} as const satisfies ToolConfig['params']

export {
  ORACLE_EPM_DATA_CONNECTION_OUTPUTS,
  ORACLE_EPM_DATA_CONNECTIONS_OUTPUTS,
  ORACLE_EPM_DATA_DOWNLOAD_OUTPUTS,
  ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS,
  ORACLE_EPM_DATA_FILES_OUTPUTS,
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  ORACLE_EPM_DATA_MESSAGE_OUTPUTS,
  ORACLE_EPM_DATA_PIPELINE_OUTPUTS,
  ORACLE_EPM_DATA_POV_OUTPUTS,
  ORACLE_EPM_DATA_STATUS_OUTPUTS,
  ORACLE_EPM_DATA_SUBMISSION_OUTPUTS,
} from '@/tools/oracle_epm_data/types'
