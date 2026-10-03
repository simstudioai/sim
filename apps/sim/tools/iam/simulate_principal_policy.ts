import type {
  IAMSimulatePrincipalPolicyParams,
  IAMSimulatePrincipalPolicyResponse,
} from '@/tools/iam/types'
import type { InternalToolConfig } from '@/tools/types'

export const simulatePrincipalPolicyTool: InternalToolConfig<
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
        'Comma-separated list of resource ARNs to simulate against (defaults to * if not provided). Read the per-ARN verdict from resourceSpecificResults, not from evalDecision.',
    },
    contextEntries: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      maxItems: 64,
      items: {
        type: 'object',
        properties: {
          contextKeyName: {
            type: 'string',
            description: 'Full condition context key name, e.g. aws:SourceIp or s3:VersionId',
          },
          contextKeyValues: {
            type: 'array',
            items: { type: 'string' },
            description: 'Values to supply for the key',
          },
          contextKeyType: {
            type: 'string',
            description:
              'Data type of the values: string, stringList, numeric, numericList, boolean, booleanList, ip, ipList, binary, binaryList, date, or dateList',
          },
        },
        required: ['contextKeyName', 'contextKeyValues', 'contextKeyType'],
      },
      description:
        'Condition context keys to supply to the simulation. Without these, any policy gated by a Condition simulates as denied with missing context values.',
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

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      policySourceArn: params.policySourceArn,
      actionNames: params.actionNames,
      resourceArns: params.resourceArns,
      contextEntries: params.contextEntries,
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
        'One result per simulated action. evalDecision is the AGGREGATE, most-restrictive decision across every resource ARN, and evalResourceName is the resource-type ARN template (e.g. an arn:aws:s3:::BUCKET/KEY shape with the bucket and key left as placeholders), not a customer ARN. For the verdict on an individual ARN read resourceSpecificResults[]: evalResourceName, evalResourceDecision (allowed/explicitDeny/implicitDeny), matchedStatements, missingContextValues, permissionsBoundaryAllowed. When concrete resource ARNs are supplied, missing context values appear there rather than at the top level.',
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
