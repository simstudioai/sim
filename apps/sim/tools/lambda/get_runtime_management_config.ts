import { isSupplied } from '@/tools/lambda/supplied'
import type {
  LambdaGetRuntimeManagementConfigParams,
  LambdaGetRuntimeManagementConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const getRuntimeManagementConfigTool: InternalToolConfig<
  LambdaGetRuntimeManagementConfigParams,
  LambdaGetRuntimeManagementConfigResponse
> = {
  id: 'lambda_get_runtime_management_config',
  name: 'Lambda Get Runtime Management Config',
  description: 'Get the runtime update policy of a function version',
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
      description: 'Version number or alias name to act on. Omit to target the function itself',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(isSupplied(params.qualifier) && { qualifier: params.qualifier }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

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
      description: 'Auto, FunctionUpdate, or Manual runtime update policy',
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
