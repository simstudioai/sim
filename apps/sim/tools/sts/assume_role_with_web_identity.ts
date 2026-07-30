import type {
  STSAssumeRoleWithWebIdentityParams,
  STSAssumeRoleWithWebIdentityResponse,
} from '@/tools/sts/types'
import type { ToolConfig } from '@/tools/types'

export const assumeRoleWithWebIdentityTool: ToolConfig<
  STSAssumeRoleWithWebIdentityParams,
  STSAssumeRoleWithWebIdentityResponse
> = {
  id: 'sts_assume_role_with_web_identity',
  name: 'STS Assume Role With Web Identity',
  description:
    'Assume an IAM role using an OIDC/OAuth 2.0 web identity token (e.g. GitHub Actions OIDC, EKS IRSA, Google/Facebook federation) and receive temporary security credentials',
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
    roleSessionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier for the assumed role session',
    },
    webIdentityToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'OAuth 2.0 access token or OpenID Connect ID token from the identity provider (up to 20000 chars)',
    },
    providerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fully qualified host of a legacy OAuth 2.0 provider (e.g. www.amazon.com); omit for OpenID Connect providers',
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
    url: '/api/tools/sts/assume-role-with-web-identity',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      roleArn: params.roleArn,
      roleSessionName: params.roleSessionName,
      webIdentityToken: params.webIdentityToken,
      providerId: params.providerId,
      policyArns: params.policyArns,
      policy: params.policy,
      durationSeconds: params.durationSeconds,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to assume role with web identity')
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
        subjectFromWebIdentityToken: data.subjectFromWebIdentityToken ?? '',
        audience: data.audience ?? null,
        provider: data.provider ?? null,
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
    subjectFromWebIdentityToken: {
      type: 'string',
      description: "Unique user identifier from the identity provider's token subject claim",
    },
    audience: {
      type: 'string',
      description: 'Intended audience (client ID) of the web identity token',
      optional: true,
    },
    provider: {
      type: 'string',
      description: 'Issuing authority of the presented web identity token',
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
