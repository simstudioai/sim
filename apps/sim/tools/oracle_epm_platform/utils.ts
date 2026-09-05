import type { ToolConfig } from '@/tools/types'

export const oracleEpmPlatformAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential for this environment',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic-auth material injected by the executor from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'REST base URL injected by the executor from the selected credential',
  },
} satisfies ToolConfig['params']
