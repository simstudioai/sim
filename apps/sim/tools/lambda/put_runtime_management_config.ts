import type {
  LambdaPutRuntimeManagementConfigParams,
  LambdaPutRuntimeManagementConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const putRuntimeManagementConfigTool: InternalToolConfig<
  LambdaPutRuntimeManagementConfigParams,
  LambdaPutRuntimeManagementConfigResponse
> = {
  id: 'lambda_put_runtime_management_config',
  name: 'Lambda Set Runtime Management Config',
  description: 'Set how and when Lambda applies runtime updates to a function version',
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
    updateRuntimeOn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Auto applies updates automatically, FunctionUpdate applies them on the next function update, Manual pins a runtime version',
    },
    runtimeVersionArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the runtime version to pin to. Required when updateRuntimeOn is Manual',
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
      updateRuntimeOn: params.updateRuntimeOn,
      ...(params.runtimeVersionArn !== undefined && {
        runtimeVersionArn: params.runtimeVersionArn,
      }),
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set Lambda runtime management configuration')
    }

    return {
      success: true,
      output: {
        updateRuntimeOn: data.output.updateRuntimeOn,
        runtimeVersionArn: data.output.runtimeVersionArn,
        functionArn: data.output.functionArn,
      },
    }
  },

  outputs: {
    updateRuntimeOn: {
      type: 'string',
      description: 'The runtime update policy now in effect',
      nullable: true,
    },
    runtimeVersionArn: {
      type: 'string',
      description: 'ARN of the pinned runtime version, when the policy is Manual',
      nullable: true,
    },
    functionArn: {
      type: 'string',
      description: 'ARN of the function the policy applies to',
      nullable: true,
    },
  },
}
