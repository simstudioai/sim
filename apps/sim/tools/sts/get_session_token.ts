import type { STSGetSessionTokenParams, STSGetSessionTokenResponse } from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const getSessionTokenTool: ToolConfig<STSGetSessionTokenParams, STSGetSessionTokenResponse> =
  {
    id: 'sts_get_session_token',
    name: 'STS Get Session Token',
    description: 'Get temporary security credentials for an IAM user, optionally with MFA',
    version: '1.0.0',

    params: {
      region: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS region (e.g., us-east-1)',
      },
      accessKeyId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS access key ID',
      },
      secretAccessKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'AWS secret access key',
      },
      durationSeconds: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Duration of the session in seconds (900-129600, default 43200)',
      },
      serialNumber: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'MFA device serial number or ARN',
      },
      tokenCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'MFA token code (6 digits)',
      },
    },

    request: {
      url: '/api/tools/sts/get-session-token',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        durationSeconds: params.durationSeconds,
        serialNumber: params.serialNumber,
        tokenCode: params.tokenCode,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get session token')
      }

      return {
        success: true,
        output: {
          accessKeyId: data.accessKeyId ?? '',
          secretAccessKey: data.secretAccessKey ?? '',
          sessionToken: data.sessionToken ?? '',
          expiration: data.expiration ?? null,
        },
      }
    },

    outputs: {
      accessKeyId: { type: 'string', description: 'Temporary access key ID' },
      secretAccessKey: { type: 'string', description: 'Temporary secret access key' },
      sessionToken: { type: 'string', description: 'Temporary session token' },
      expiration: { type: 'string', description: 'Credential expiration timestamp' },
    },
  }
