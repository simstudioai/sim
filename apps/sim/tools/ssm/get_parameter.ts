import type { SsmGetParameterParams, SsmGetParameterResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const getParameterTool: InternalToolConfig<SsmGetParameterParams, SsmGetParameterResponse> =
  {
    id: 'ssm_get_parameter',
    name: 'SSM Get Parameter',
    description: 'Read one parameter from AWS Systems Manager Parameter Store',
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
        description: 'Name of the parameter, optionally with a :version or :label suffix',
      },
      withDecryption: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Return the decrypted value of a SecureString parameter; ignored for String and StringList parameters',
      },
    },

    operation: {
      input: (params) => ({
        region: params.region,
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        name: params.name,
        withDecryption: params.withDecryption,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get parameter')
      }

      return {
        success: true,
        output: {
          name: data.name ?? '',
          type: data.type ?? '',
          value: data.value ?? '',
          version: data.version ?? null,
          selector: data.selector ?? null,
          sourceResult: data.sourceResult ?? null,
          lastModifiedDate: data.lastModifiedDate ?? null,
          arn: data.arn ?? '',
          dataType: data.dataType ?? null,
        },
        error: undefined,
      }
    },

    outputs: {
      name: {
        type: 'string',
        description: 'Name of the parameter',
      },
      type: {
        type: 'string',
        description: 'Parameter type (String, StringList, or SecureString)',
      },
      value: {
        type: 'string',
        description: 'Parameter value; encrypted unless withDecryption was set for a SecureString',
      },
      version: {
        type: 'number',
        description: 'Version of the parameter',
        optional: true,
      },
      selector: {
        type: 'string',
        description: 'Version or label selector used to read the parameter',
        optional: true,
      },
      sourceResult: {
        type: 'string',
        description: 'Raw result from the source for a parameter served by another service',
        optional: true,
      },
      lastModifiedDate: {
        type: 'string',
        description: 'When the parameter was last changed',
        optional: true,
      },
      arn: {
        type: 'string',
        description: 'ARN of the parameter',
      },
      dataType: {
        type: 'string',
        description: 'Data type of the parameter (text, aws:ec2:image, or aws:ssm:integration)',
        optional: true,
      },
    },
  }
