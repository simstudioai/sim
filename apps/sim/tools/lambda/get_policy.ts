import type { LambdaGetPolicyParams, LambdaGetPolicyResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getPolicyTool: InternalToolConfig<LambdaGetPolicyParams, LambdaGetPolicyResponse> = {
  id: 'lambda_get_policy',
  name: 'Lambda Get Policy',
  description: 'Get the resource-based IAM policy attached to a function, version, or alias',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Function name, ARN, or partial ARN (e.g. my-function, or arn:aws:lambda:us-east-1:123456789012:function:my-function)',
    },
    qualifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number or alias name to act on (defaults to $LATEST)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Lambda function policy')
    }

    return {
      success: true,
      output: {
        policy: data.output.policy,
        revisionId: data.output.revisionId,
      },
    }
  },

  outputs: {
    policy: {
      type: 'string',
      description: 'The resource-based policy, as a JSON document string',
      nullable: true,
    },
    revisionId: {
      type: 'string',
      description: 'Current revision ID of the policy',
      nullable: true,
    },
  },
}
