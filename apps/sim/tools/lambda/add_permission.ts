import { isSupplied } from '@/tools/lambda/supplied'
import type { LambdaAddPermissionParams, LambdaAddPermissionResponse } from '@/tools/lambda/types'
import type { InternalToolConfig } from '@/tools/types'

export const addPermissionTool: InternalToolConfig<
  LambdaAddPermissionParams,
  LambdaAddPermissionResponse
> = {
  id: 'lambda_add_permission',
  name: 'Lambda Add Permission',
  description: 'Grant an AWS service, account, or organization permission to use a function',
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
      description:
        'Unique identifier for the policy statement (letters, numbers, hyphens, and underscores)',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action the principal is granted, such as lambda:InvokeFunction',
    },
    principal: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'AWS service principal or account ID granted the permission, such as s3.amazonaws.com',
    },
    sourceArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the AWS resource allowed to invoke the function',
    },
    sourceAccount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the AWS account that owns the source resource',
    },
    principalOrgId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'AWS Organizations ID to grant permission to every account in the organization',
    },
    eventSourceToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token that must be supplied by the invoker (Alexa Smart Home functions only)',
    },
    functionUrlAuthType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auth type of the function URL this permission applies to',
    },
    qualifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version number or alias name to act on. Omit to target the function itself',
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
      action: params.action,
      principal: params.principal,
      ...(isSupplied(params.sourceArn) && { sourceArn: params.sourceArn }),
      ...(isSupplied(params.sourceAccount) && { sourceAccount: params.sourceAccount }),
      ...(isSupplied(params.principalOrgId) && { principalOrgId: params.principalOrgId }),
      ...(isSupplied(params.eventSourceToken) && { eventSourceToken: params.eventSourceToken }),
      ...(isSupplied(params.functionUrlAuthType) && {
        functionUrlAuthType: params.functionUrlAuthType,
      }),
      ...(isSupplied(params.qualifier) && { qualifier: params.qualifier }),
      ...(isSupplied(params.revisionId) && { revisionId: params.revisionId }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        statement: data.output.statement,
      },
    }
  },

  outputs: {
    statement: {
      type: 'string',
      description: 'The permission statement that was added, as a JSON document string',
      nullable: true,
    },
  },
}
