import type {
  LambdaUpdateFunctionUrlConfigParams,
  LambdaUpdateFunctionUrlConfigResponse,
} from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const updateFunctionUrlConfigTool: InternalToolConfig<
  LambdaUpdateFunctionUrlConfigParams,
  LambdaUpdateFunctionUrlConfigResponse
> = {
  id: 'lambda_update_function_url_config',
  name: 'Lambda Update Function URL',
  description: 'Update the auth type, invoke mode, or CORS settings of a function URL',
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
    authType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'AWS_IAM requires signed requests, NONE allows public unauthenticated access',
    },
    qualifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number or alias name to act on (defaults to $LATEST)',
    },
    invokeMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BUFFERED returns the whole response at once, RESPONSE_STREAM streams it',
    },
    corsAllowCredentials: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the function URL sends the Access-Control-Allow-Credentials header',
    },
    corsAllowOrigins: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Origins allowed to call the function URL, or * for any',
    },
    corsAllowMethods: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'HTTP methods allowed when calling the function URL, or * for any',
    },
    corsAllowHeaders: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Headers browsers may send in a cross-origin request',
    },
    corsExposeHeaders: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description: 'Response headers browsers may access from the response',
    },
    corsMaxAge: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds a browser may cache the CORS preflight result (0-86400)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      functionName: params.functionName,
      ...(params.authType !== undefined && { authType: params.authType }),
      ...(params.qualifier !== undefined && { qualifier: params.qualifier }),
      ...(params.invokeMode !== undefined && { invokeMode: params.invokeMode }),
      ...(params.corsAllowCredentials !== undefined && {
        corsAllowCredentials: params.corsAllowCredentials,
      }),
      ...(params.corsAllowOrigins !== undefined && { corsAllowOrigins: params.corsAllowOrigins }),
      ...(params.corsAllowMethods !== undefined && { corsAllowMethods: params.corsAllowMethods }),
      ...(params.corsAllowHeaders !== undefined && { corsAllowHeaders: params.corsAllowHeaders }),
      ...(params.corsExposeHeaders !== undefined && {
        corsExposeHeaders: params.corsExposeHeaders,
      }),
      ...(params.corsMaxAge !== undefined && { corsMaxAge: params.corsMaxAge }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update Lambda function URL configuration')
    }

    return {
      success: true,
      output: {
        functionUrlConfig: data.output.functionUrlConfig,
      },
    }
  },

  outputs: {
    functionUrlConfig: {
      type: 'json',
      description: 'The function URL with its auth type, invoke mode, and CORS settings',
    },
  },
}
