import type {
  IAMSimulatePrincipalPolicyParams,
  IAMSimulatePrincipalPolicyResponse,
} from '@/tools/iam/types'
import type { ToolConfig } from '@/tools/types'

export const simulatePrincipalPolicyTool: ToolConfig<
  IAMSimulatePrincipalPolicyParams,
  IAMSimulatePrincipalPolicyResponse
> = {
  id: 'iam_simulate_principal_policy',
  name: 'IAM Simulate Principal Policy',
  description:
    'Simulate whether a user, role, or group is allowed to perform specific AWS actions — useful for pre-flight access checks',
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
    policySourceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ARN of the user, group, or role to simulate (e.g., arn:aws:iam::123456789012:user/alice)',
    },
    actionNames: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of AWS actions to simulate (e.g., s3:GetObject,ec2:DescribeInstances)',
    },
    resourceArns: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of resource ARNs to simulate against (defaults to * if not provided)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of simulation results to return (1-1000)',
    },
    marker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination marker from a previous request',
    },
  },

  request: {
    url: '/api/tools/iam/simulate-principal-policy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      policySourceArn: params.policySourceArn,
      actionNames: params.actionNames,
      resourceArns: params.resourceArns,
      maxResults: params.maxResults,
      marker: params.marker,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to simulate principal policy')
    }
    return {
      success: true,
      output: {
        evaluationResults: data.evaluationResults ?? [],
        isTruncated: data.isTruncated ?? false,
        marker: data.marker ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    evaluationResults: {
      type: 'json',
      description:
        'Simulation results per action: evalActionName, evalResourceName, evalDecision (allowed/explicitDeny/implicitDeny), matchedStatements (sourcePolicyId, sourcePolicyType), missingContextValues',
    },
    isTruncated: {
      type: 'boolean',
      description: 'Whether there are more results available',
    },
    marker: {
      type: 'string',
      description: 'Pagination marker for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of evaluation results returned' },
  },
}
