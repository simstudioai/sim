import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaInvokeParams, LambdaInvokeResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const invokeTool: InternalToolConfig<LambdaInvokeParams, LambdaInvokeResponse> = {
  id: 'lambda_invoke',
  name: 'Lambda Invoke Function',
  description: 'Invoke a Lambda function synchronously or asynchronously and return its response',
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
    payload: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON event payload passed to the function handler',
    },
    invocationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'RequestResponse waits for the result, Event queues the invocation, DryRun only validates permissions',
    },
    logType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to Tail to return the last 4 KB of the execution log',
    },
    clientContext: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Base64-encoded JSON passed to the function in the client context object (max 3,583 bytes)',
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
      ...(isSupplied(params.payload) && { payload: params.payload }),
      ...(isSupplied(params.invocationType) && { invocationType: params.invocationType }),
      ...(isSupplied(params.logType) && { logType: params.logType }),
      ...(isSupplied(params.clientContext) && { clientContext: params.clientContext }),
      ...(isSupplied(params.qualifier) && { qualifier: params.qualifier }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        statusCode: data.output.statusCode,
        payload: data.output.payload,
        functionError: data.output.functionError,
        logResult: data.output.logResult,
        executedVersion: data.output.executedVersion,
      },
    }
  },

  outputs: {
    statusCode: {
      type: 'number',
      description:
        'HTTP status of the invocation (200 for RequestResponse, 202 for Event, 204 for DryRun)',
      nullable: true,
    },
    payload: {
      type: 'json',
      description: 'The response returned by the function, parsed as JSON when possible',
      nullable: true,
    },
    functionError: {
      type: 'string',
      description: 'Set to Handled or Unhandled when the function itself returned an error',
      nullable: true,
    },
    logResult: {
      type: 'string',
      description: 'Decoded execution log tail, present only when logType is Tail',
      nullable: true,
    },
    executedVersion: {
      type: 'string',
      description: 'The function version that was executed',
      nullable: true,
    },
  },
}
