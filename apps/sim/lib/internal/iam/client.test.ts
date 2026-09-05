/**
 * @vitest-environment node
 */
import type { IAMClient, SimulatePrincipalPolicyCommandOutput } from '@aws-sdk/client-iam'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPolicies, simulatePrincipalPolicy } from '@/lib/internal/iam/client'

const mockSend = vi.fn()

/** A stub standing in for the AWS SDK client; only `send` is exercised. */
function createStubClient(): IAMClient {
  // double-cast-allowed: test stub implements only the single SDK method under test
  return { send: mockSend } as unknown as IAMClient
}

/**
 * The literal ARN template AWS echoes back on the top-level result. The braces are escaped
 * so the linter does not read AWS's placeholders as JavaScript interpolation.
 */
const AWS_ARN_TEMPLATE = `arn:$\{Partition}:s3:::$\{BucketName}/$\{KeyName}`

/**
 * A realistic SimulatePrincipalPolicy payload for ONE action across TWO buckets:
 * allowed on bucket-a, explicitly denied on bucket-b.
 *
 * AWS returns a single EvaluationResult per action regardless of resource count. Its
 * EvalDecision is the aggregate, most-restrictive decision (explicitDeny here, because
 * bucket-b denies), its EvalResourceName is an ARN template rather than either bucket,
 * and its MissingContextValues is empty because concrete ResourceArns were supplied —
 * per-resource missing context moves into ResourceSpecificResults.
 */
const MULTI_RESOURCE_RESPONSE = {
  EvaluationResults: [
    {
      EvalActionName: 's3:GetObject',
      EvalResourceName: AWS_ARN_TEMPLATE,
      EvalDecision: 'explicitDeny',
      MatchedStatements: [{ SourcePolicyId: 'DenyBucketB', SourcePolicyType: 'IAM Policy' }],
      MissingContextValues: [],
      PermissionsBoundaryDecisionDetail: { AllowedByPermissionsBoundary: true },
      ResourceSpecificResults: [
        {
          EvalResourceName: 'arn:aws:s3:::bucket-a/*',
          EvalResourceDecision: 'allowed',
          MatchedStatements: [{ SourcePolicyId: 'AllowReadA', SourcePolicyType: 'IAM Policy' }],
          MissingContextValues: [],
          PermissionsBoundaryDecisionDetail: { AllowedByPermissionsBoundary: true },
        },
        {
          EvalResourceName: 'arn:aws:s3:::bucket-b/*',
          EvalResourceDecision: 'explicitDeny',
          MatchedStatements: [{ SourcePolicyId: 'DenyBucketB', SourcePolicyType: 'IAM Policy' }],
          MissingContextValues: ['aws:SourceIp'],
          PermissionsBoundaryDecisionDetail: { AllowedByPermissionsBoundary: false },
        },
      ],
    },
  ],
  IsTruncated: false,
} satisfies Partial<SimulatePrincipalPolicyCommandOutput>

describe('simulatePrincipalPolicy response mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the per-resource decision for every simulated ARN', async () => {
    mockSend.mockResolvedValue(MULTI_RESOURCE_RESPONSE)

    const result = await simulatePrincipalPolicy(createStubClient(), {
      policySourceArn: 'arn:aws:iam::123456789012:user/alice',
      actionNames: 's3:GetObject',
      resourceArns: 'arn:aws:s3:::bucket-a/*, arn:aws:s3:::bucket-b/*',
    })

    expect(result.evaluationResults).toHaveLength(1)
    const [evaluation] = result.evaluationResults

    expect(evaluation.resourceSpecificResults).toEqual([
      {
        evalResourceName: 'arn:aws:s3:::bucket-a/*',
        evalResourceDecision: 'allowed',
        matchedStatements: [{ sourcePolicyId: 'AllowReadA', sourcePolicyType: 'IAM Policy' }],
        missingContextValues: [],
        permissionsBoundaryAllowed: true,
      },
      {
        evalResourceName: 'arn:aws:s3:::bucket-b/*',
        evalResourceDecision: 'explicitDeny',
        matchedStatements: [{ sourcePolicyId: 'DenyBucketB', sourcePolicyType: 'IAM Policy' }],
        missingContextValues: ['aws:SourceIp'],
        permissionsBoundaryAllowed: false,
      },
    ])
  })

  it('does not let the aggregate decision stand in for the allowed resource', async () => {
    mockSend.mockResolvedValue(MULTI_RESOURCE_RESPONSE)

    const result = await simulatePrincipalPolicy(createStubClient(), {
      policySourceArn: 'arn:aws:iam::123456789012:user/alice',
      actionNames: 's3:GetObject',
      resourceArns: 'arn:aws:s3:::bucket-a/*,arn:aws:s3:::bucket-b/*',
    })

    const [evaluation] = result.evaluationResults
    expect(evaluation.evalDecision).toBe('explicitDeny')

    const decisionByResource = new Map(
      evaluation.resourceSpecificResults.map((r) => [r.evalResourceName, r.evalResourceDecision])
    )
    expect(decisionByResource.get('arn:aws:s3:::bucket-a/*')).toBe('allowed')
    expect(decisionByResource.get('arn:aws:s3:::bucket-b/*')).toBe('explicitDeny')
  })

  it('keeps missing context values that AWS moved into the per-resource results', async () => {
    mockSend.mockResolvedValue(MULTI_RESOURCE_RESPONSE)

    const result = await simulatePrincipalPolicy(createStubClient(), {
      policySourceArn: 'arn:aws:iam::123456789012:user/alice',
      actionNames: 's3:GetObject',
      resourceArns: 'arn:aws:s3:::bucket-a/*,arn:aws:s3:::bucket-b/*',
    })

    const [evaluation] = result.evaluationResults
    expect(evaluation.missingContextValues).toEqual([])
    expect(evaluation.resourceSpecificResults.flatMap((r) => r.missingContextValues)).toEqual([
      'aws:SourceIp',
    ])
  })

  it('sends both resource ARNs and the supplied condition context keys to AWS', async () => {
    mockSend.mockResolvedValue(MULTI_RESOURCE_RESPONSE)

    await simulatePrincipalPolicy(createStubClient(), {
      policySourceArn: 'arn:aws:iam::123456789012:user/alice',
      actionNames: 's3:GetObject, s3:PutObject',
      resourceArns: 'arn:aws:s3:::bucket-a/*,arn:aws:s3:::bucket-b/*',
      contextEntries: [
        {
          contextKeyName: 'aws:SourceIp',
          contextKeyValues: ['203.0.113.10'],
          contextKeyType: 'ip',
        },
      ],
    })

    expect(mockSend).toHaveBeenCalledOnce()
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      PolicySourceArn: 'arn:aws:iam::123456789012:user/alice',
      ActionNames: ['s3:GetObject', 's3:PutObject'],
      ResourceArns: ['arn:aws:s3:::bucket-a/*', 'arn:aws:s3:::bucket-b/*'],
      ContextEntries: [
        {
          ContextKeyName: 'aws:SourceIp',
          ContextKeyValues: ['203.0.113.10'],
          ContextKeyType: 'ip',
        },
      ],
    })
  })

  it('defaults to simulating against * when no resource ARNs are supplied', async () => {
    mockSend.mockResolvedValue({ EvaluationResults: [], IsTruncated: false })

    await simulatePrincipalPolicy(createStubClient(), {
      policySourceArn: 'arn:aws:iam::123456789012:user/alice',
      actionNames: 'iam:ListUsers',
    })

    expect(mockSend.mock.calls[0][0].input.ResourceArns).toEqual(['*'])
    expect(mockSend.mock.calls[0][0].input.ContextEntries).toBeUndefined()
  })
})

describe('listPolicies response mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits the description AWS never returns from ListPolicies', async () => {
    mockSend.mockResolvedValue({
      Policies: [
        {
          PolicyName: 'ReadOnlyAccess',
          PolicyId: 'ANPAI7XKCFMBPM3QQRRVQ',
          Arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
          Path: '/',
          AttachmentCount: 3,
          IsAttachable: true,
          DefaultVersionId: 'v1',
          PermissionsBoundaryUsageCount: 0,
        },
      ],
      IsTruncated: false,
    })

    const result = await listPolicies(createStubClient(), 'AWS')

    expect(result.policies).toHaveLength(1)
    expect(result.policies[0]).not.toHaveProperty('description')
    expect(mockSend.mock.calls[0][0].input.Scope).toBe('AWS')
  })
})
