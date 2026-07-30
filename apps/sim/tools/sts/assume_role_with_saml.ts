import type { STSAssumeRoleWithSAMLParams, STSAssumeRoleWithSAMLResponse } from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const assumeRoleWithSAMLTool: ToolConfig<
  STSAssumeRoleWithSAMLParams,
  STSAssumeRoleWithSAMLResponse
> = {
  id: 'sts_assume_role_with_saml',
  name: 'STS Assume Role With SAML',
  description:
    'Assume an IAM role using a SAML 2.0 authentication response from an enterprise identity provider and receive temporary security credentials',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    roleArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the IAM role to assume',
    },
    principalArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the SAML provider in IAM that describes the identity provider',
    },
    samlAssertion: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Base64-encoded SAML authentication response from the identity provider',
    },
    policyArns: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated ARNs of up to 10 IAM managed policies to use as session policies',
    },
    policy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON IAM policy to further restrict session permissions (max 2048 chars)',
    },
    durationSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration of the session in seconds (900-43200, default 3600)',
    },
  },

  request: {
    url: '/api/tools/sts/assume-role-with-saml',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      roleArn: params.roleArn,
      principalArn: params.principalArn,
      samlAssertion: params.samlAssertion,
      policyArns: params.policyArns,
      policy: params.policy,
      durationSeconds: params.durationSeconds,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to assume role with SAML')
    }

    return {
      success: true,
      output: {
        accessKeyId: data.accessKeyId ?? '',
        secretAccessKey: data.secretAccessKey ?? '',
        sessionToken: data.sessionToken ?? '',
        expiration: data.expiration ?? null,
        assumedRoleArn: data.assumedRoleArn ?? '',
        assumedRoleId: data.assumedRoleId ?? '',
        subject: data.subject ?? null,
        subjectType: data.subjectType ?? null,
        issuer: data.issuer ?? null,
        audience: data.audience ?? null,
        nameQualifier: data.nameQualifier ?? null,
        packedPolicySize: data.packedPolicySize ?? null,
        sourceIdentity: data.sourceIdentity ?? null,
      },
    }
  },

  outputs: {
    accessKeyId: { type: 'string', description: 'Temporary access key ID' },
    secretAccessKey: { type: 'string', description: 'Temporary secret access key' },
    sessionToken: { type: 'string', description: 'Temporary session token' },
    expiration: { type: 'string', description: 'Credential expiration timestamp', optional: true },
    assumedRoleArn: { type: 'string', description: 'ARN of the assumed role' },
    assumedRoleId: { type: 'string', description: 'Assumed role ID with session name' },
    subject: {
      type: 'string',
      description: 'Value of the NameID element in the Subject of the SAML assertion',
      optional: true,
    },
    subjectType: {
      type: 'string',
      description: 'Format of the name ID (e.g. transient, persistent)',
      optional: true,
    },
    issuer: {
      type: 'string',
      description: 'Value of the Issuer element of the SAML assertion',
      optional: true,
    },
    audience: {
      type: 'string',
      description: "Value of the SAML assertion's SubjectConfirmationData Recipient attribute",
      optional: true,
    },
    nameQualifier: {
      type: 'string',
      description: 'Hash uniquely identifying the issuer, account, and SAML provider',
      optional: true,
    },
    packedPolicySize: {
      type: 'number',
      description: 'Percentage of allowed policy size used',
      optional: true,
    },
    sourceIdentity: {
      type: 'string',
      description: 'Source identity set on the role session, if any',
      optional: true,
    },
  },
}
