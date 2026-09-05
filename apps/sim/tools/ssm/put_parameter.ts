import type { SsmPutParameterParams, SsmPutParameterResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const putParameterTool: InternalToolConfig<SsmPutParameterParams, SsmPutParameterResponse> =
  {
    id: 'ssm_put_parameter',
    name: 'SSM Put Parameter',
    description: 'Create or update a parameter in AWS Systems Manager Parameter Store',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the parameter, optionally using a slash-separated hierarchy',
      },
      value: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Value to store',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Parameter type (String, StringList, or SecureString); required when creating a new parameter',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Description of the parameter',
      },
      keyId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'KMS key ID or ARN used to encrypt a SecureString parameter; defaults to the account key',
      },
      overwrite: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Overwrite the parameter if it already exists',
      },
      allowedPattern: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Regular expression the value must match',
      },
      tier: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Parameter tier (Standard, Advanced, or Intelligent-Tiering)',
      },
      dataType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Data type of the parameter (text, aws:ec2:image, or aws:ssm:integration)',
      },
      policies: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Parameter policies as a JSON array string; Advanced tier only',
      },
    },

    operation: {
      input: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        name: params.name,
        value: params.value,
        type: params.type,
        description: params.description,
        keyId: params.keyId,
        overwrite: params.overwrite,
        allowedPattern: params.allowedPattern,
        tier: params.tier,
        dataType: params.dataType,
        policies: params.policies,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to put parameter')
      }

      return {
        success: true,
        output: {
          message: data.message ?? '',
          name: data.name ?? '',
          version: data.version ?? null,
          tier: data.tier ?? null,
        },
        error: undefined,
      }
    },

    outputs: {
      message: {
        type: 'string',
        description: 'Operation status message',
      },
      name: {
        type: 'string',
        description: 'Name of the parameter that was written',
      },
      version: {
        type: 'number',
        description: 'Version number the write produced',
        optional: true,
      },
      tier: {
        type: 'string',
        description: 'Tier the parameter was stored in',
        optional: true,
      },
    },
  }
