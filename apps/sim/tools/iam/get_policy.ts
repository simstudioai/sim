import type { IAMGetPolicyParams, IAMGetPolicyResponse } from '@/tools/iam/types'
import type { InternalToolConfig } from '@/tools/types'

export const getPolicyTool: InternalToolConfig<IAMGetPolicyParams, IAMGetPolicyResponse> = {
  id: 'iam_get_policy',
  name: 'IAM Get Policy',
  description:
    'Get details about a managed IAM policy, including its description — the field ListPolicies never returns',
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
    policyArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ARN of the managed policy to retrieve (e.g., arn:aws:iam::aws:policy/ReadOnlyAccess)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      policyArn: params.policyArn,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get IAM policy')
    }

    return {
      success: true,
      output: {
        policyName: data.policyName ?? '',
        policyId: data.policyId ?? '',
        arn: data.arn ?? '',
        path: data.path ?? '',
        attachmentCount: data.attachmentCount ?? 0,
        isAttachable: data.isAttachable ?? false,
        createDate: data.createDate ?? null,
        updateDate: data.updateDate ?? null,
        description: data.description ?? null,
        defaultVersionId: data.defaultVersionId ?? null,
        permissionsBoundaryUsageCount: data.permissionsBoundaryUsageCount ?? 0,
        tags: data.tags ?? [],
      },
    }
  },

  outputs: {
    policyName: { type: 'string', description: 'The friendly name of the policy' },
    policyId: { type: 'string', description: 'The stable unique ID of the policy' },
    arn: { type: 'string', description: 'The ARN of the policy' },
    path: { type: 'string', description: 'The path to the policy' },
    attachmentCount: {
      type: 'number',
      description: 'Number of entities the policy is attached to',
    },
    isAttachable: { type: 'boolean', description: 'Whether the policy can be attached' },
    createDate: { type: 'string', description: 'Date the policy was created', optional: true },
    updateDate: {
      type: 'string',
      description: 'Date the policy was last updated',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'The policy description',
      optional: true,
    },
    defaultVersionId: {
      type: 'string',
      description: 'The identifier of the default policy version',
      optional: true,
    },
    permissionsBoundaryUsageCount: {
      type: 'number',
      description: 'Number of entities using the policy as a permissions boundary',
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the policy (key, value pairs)',
      optional: true,
    },
  },
}
