import type {
  LambdaRemovePermissionParams,
  LambdaRemovePermissionResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const removePermissionTool: InternalToolConfig<
  LambdaRemovePermissionParams,
  LambdaRemovePermissionResponse
> = {
  id: 'lambda_remove_permission',
  name: 'Lambda Remove Permission',
  description: "Remove a statement from a function's resource-based policy",
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
    statementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the policy statement to remove',
    },
    qualifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number or alias name to act on (defaults to $LATEST)',
    },
    revisionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Update the resource only if its current revision ID matches this value',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      statementId: params.statementId,
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
      ...(params.revisionId !== undefined && { revisionId: params.revisionId }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to remove Lambda permission')
    }

    return {
      success: true,
      output: {
        message: data.output.message,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
