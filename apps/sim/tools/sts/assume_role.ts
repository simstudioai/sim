import type { STSAssumeRoleParams, STSAssumeRoleResponse } from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const assumeRoleTool: ToolConfig<STSAssumeRoleParams, STSAssumeRoleResponse> = {
  id: 'sts_assume_role',
  name: 'STS Assume Role',
  description: 'Assume an IAM role and receive temporary security credentials',
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
    roleArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the IAM role to assume',
    },
    roleSessionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier for the assumed role session',
    },
    durationSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration of the session in seconds (900-43200, default 3600)',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External ID for cross-account access',
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
    url: '/api/tools/sts/assume-role',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      roleArn: params.roleArn,
      roleSessionName: params.roleSessionName,
      durationSeconds: params.durationSeconds,
      externalId: params.externalId,
      serialNumber: params.serialNumber,
      tokenCode: params.tokenCode,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to assume role')
    }

    return {
      success: true,
      output: {
        accessKeyId: data.accessKeyId ?? '',
        secretAccessKey: data.secretAccessKey ?? '',
        sessionToken: data.sessionToken ?? '',
        expiration: data.expiration ?? null,
        assumedRoleArn: data.assumedRoleArn ?? '',
        assumedRoleId: data.assumedRoleId ?? '',
        packedPolicySize: data.packedPolicySize ?? null,
      },
    }
  },

  outputs: {
    accessKeyId: { type: 'string', description: 'Temporary access key ID' },
    secretAccessKey: { type: 'string', description: 'Temporary secret access key' },
    sessionToken: { type: 'string', description: 'Temporary session token' },
    expiration: { type: 'string', description: 'Credential expiration timestamp' },
    assumedRoleArn: { type: 'string', description: 'ARN of the assumed role' },
    assumedRoleId: { type: 'string', description: 'Assumed role ID with session name' },
    packedPolicySize: {
      type: 'number',
      description: 'Percentage of allowed policy size used',
      optional: true,
    },
  },
}
