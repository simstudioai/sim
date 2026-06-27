import { STSIcon } from '@/components/icons'
import { STSBlockDisplay } from '@/blocks/blocks/sts.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { STSBaseResponse } from '@/tools/sts/types'

export const STSBlock: BlockConfig<STSBaseResponse> = {
  ...STSBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Assume Role', id: 'assume_role' },
        { label: 'Get Caller Identity', id: 'get_caller_identity' },
        { label: 'Get Session Token', id: 'get_session_token' },
        { label: 'Get Access Key Info', id: 'get_access_key_info' },
      ],
      value: () => 'assume_role',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'roleArn',
      title: 'Role ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:role/MyRole',
      condition: { field: 'operation', value: 'assume_role' },
      required: { field: 'operation', value: 'assume_role' },
    },
    {
      id: 'roleSessionName',
      title: 'Session Name',
      type: 'short-input',
      placeholder: 'my-session',
      condition: { field: 'operation', value: 'assume_role' },
      required: { field: 'operation', value: 'assume_role' },
    },
    {
      id: 'durationSeconds',
      title: 'Duration (Seconds)',
      type: 'short-input',
      placeholder: '3600',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'policy',
      title: 'Session Policy (JSON)',
      type: 'long-input',
      placeholder: '{"Version":"2012-10-17","Statement":[...]}',
      condition: { field: 'operation', value: 'assume_role' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External ID for cross-account access',
      condition: { field: 'operation', value: 'assume_role' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'serialNumber',
      title: 'MFA Serial Number',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:mfa/user',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'tokenCode',
      title: 'MFA Token Code',
      type: 'short-input',
      placeholder: '123456',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'targetAccessKeyId',
      title: 'Target Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      condition: { field: 'operation', value: 'get_access_key_info' },
      required: { field: 'operation', value: 'get_access_key_info' },
    },
  ],
  tools: {
    access: [
      'sts_assume_role',
      'sts_get_caller_identity',
      'sts_get_session_token',
      'sts_get_access_key_info',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'assume_role':
            return 'sts_assume_role'
          case 'get_caller_identity':
            return 'sts_get_caller_identity'
          case 'get_session_token':
            return 'sts_get_session_token'
          case 'get_access_key_info':
            return 'sts_get_access_key_info'
          default:
            throw new Error(`Invalid STS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, durationSeconds, ...rest } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'assume_role':
            result.roleArn = rest.roleArn
            result.roleSessionName = rest.roleSessionName
            if (durationSeconds) {
              const parsed = Number.parseInt(String(durationSeconds), 10)
              if (!Number.isNaN(parsed)) result.durationSeconds = parsed
            }
            if (rest.policy) result.policy = rest.policy
            if (rest.externalId) result.externalId = rest.externalId
            if (rest.serialNumber) result.serialNumber = rest.serialNumber
            if (rest.tokenCode) result.tokenCode = rest.tokenCode
            break
          case 'get_caller_identity':
            break
          case 'get_session_token':
            if (durationSeconds) {
              const parsed = Number.parseInt(String(durationSeconds), 10)
              if (!Number.isNaN(parsed)) result.durationSeconds = parsed
            }
            if (rest.serialNumber) result.serialNumber = rest.serialNumber
            if (rest.tokenCode) result.tokenCode = rest.tokenCode
            break
          case 'get_access_key_info':
            result.targetAccessKeyId = rest.targetAccessKeyId
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'STS operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    roleArn: { type: 'string', description: 'ARN of the role to assume' },
    roleSessionName: { type: 'string', description: 'Session name for the assumed role' },
    durationSeconds: { type: 'string', description: 'Session duration in seconds' },
    policy: { type: 'string', description: 'JSON IAM session policy to restrict permissions' },
    externalId: { type: 'string', description: 'External ID for cross-account access' },
    serialNumber: { type: 'string', description: 'MFA device serial number' },
    tokenCode: { type: 'string', description: 'MFA token code' },
    targetAccessKeyId: { type: 'string', description: 'Access key ID to look up' },
  },
  outputs: {
    accessKeyId: {
      type: 'string',
      description: 'Temporary access key ID (assume_role, get_session_token)',
    },
    secretAccessKey: {
      type: 'string',
      description: 'Temporary secret access key (assume_role, get_session_token)',
    },
    sessionToken: {
      type: 'string',
      description: 'Temporary session token (assume_role, get_session_token)',
    },
    expiration: {
      type: 'string',
      description: 'Credential expiration timestamp (assume_role, get_session_token)',
    },
    assumedRoleArn: {
      type: 'string',
      description: 'ARN of the assumed role (assume_role only)',
    },
    assumedRoleId: {
      type: 'string',
      description: 'Assumed role ID with session name (assume_role only)',
    },
    packedPolicySize: {
      type: 'number',
      description: 'Percentage of allowed policy size used (assume_role only)',
    },
    sourceIdentity: {
      type: 'string',
      description: 'Source identity set on the role session (assume_role only)',
    },
    account: {
      type: 'string',
      description: 'AWS account ID (get_caller_identity, get_access_key_info)',
    },
    arn: {
      type: 'string',
      description: 'ARN of the calling entity (get_caller_identity only)',
    },
    userId: {
      type: 'string',
      description: 'Unique identifier of the calling entity (get_caller_identity only)',
    },
  },
}

export const STSBlockMeta = {
  tags: ['cloud', 'identity'],
  url: 'https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html',
  templates: [
    {
      icon: STSIcon,
      title: 'AWS STS access key identifier',
      prompt:
        'Build a workflow that takes an AWS access key ID, uses AWS STS to look up the owning account and entity, flags keys that belong to unexpected accounts, and pings the security Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: STSIcon,
      title: 'STS short-lived credential provisioner',
      prompt:
        'Create a workflow that on a request grants short-lived AWS STS credentials with the minimum required scope, captures the audit record, and revokes on completion.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: STSIcon,
      title: 'STS caller identity verifier',
      prompt:
        'Build a scheduled workflow that calls AWS STS get caller identity for each configured set of credentials, confirms the resolved account and ARN match the expected principal, and writes a verification report.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: STSIcon,
      title: 'STS session token rotator',
      prompt:
        'Create a scheduled daily workflow that mints fresh AWS STS session tokens for service accounts that need them, records each token expiration in a security log, and flags any token issuance that fails.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: STSIcon,
      title: 'STS just-in-time access grant',
      prompt:
        'Build a workflow that handles JIT-access requests, captures Slack-based approval, mints short-lived AWS STS credentials, and writes the access record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: STSIcon,
      title: 'STS cross-account access grant',
      prompt:
        'Create a workflow that handles cross-account access requests, assumes the target AWS STS role with the supplied external ID, requires owner attestation in Slack, and writes the grant record to a compliance table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: STSIcon,
      title: 'STS Identity-Center role broker',
      prompt:
        'Build a workflow that takes an Identity Center user request, assumes the matching AWS STS role to mint scoped short-lived credentials, writes the issuance to a session log, and alerts Slack when a request targets a privileged role.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['identity_center', 'slack'],
    },
  ],
  skills: [
    {
      name: 'assume-cross-account-role',
      description:
        'Call AWS STS to assume a role and obtain temporary credentials for a target account. Use for cross-account access in a workflow.',
      content:
        '# Assume Cross-Account Role\n\nObtain temporary credentials by assuming an IAM role.\n\n## Steps\n1. Identify the role ARN to assume and a descriptive session name.\n2. Set the session duration and any external ID required by the trust policy.\n3. Call assume role to receive temporary access key, secret key, and session token.\n4. Pass the temporary credentials to the downstream step that needs cross-account access.\n\n## Output\nConfirm the assumed role ARN and credential expiration. Never print the secret access key or session token in plain logs.',
    },
    {
      name: 'verify-caller-identity',
      description:
        'Use AWS STS get caller identity to confirm which account, user, or role the current credentials resolve to. Use to validate setup and debug auth issues.',
      content:
        '# Verify Caller Identity\n\nConfirm which AWS identity the workflow is operating as.\n\n## Steps\n1. Call get caller identity with the active credentials.\n2. Read the returned account ID, user ID, and principal ARN.\n3. Compare against the expected account and role for the task.\n4. If it does not match, flag a likely credential or assume-role misconfiguration.\n\n## Output\nReport the account ID and ARN of the active identity, and whether it matches the expected principal.',
    },
    {
      name: 'mint-mfa-session-token',
      description:
        'Use AWS STS to mint short-lived session credentials, optionally backed by an MFA token, for IAM-user workflows that require MFA. Use for time-boxed elevated sessions.',
      content:
        '# Mint MFA Session Token\n\nIssue temporary credentials, optionally enforcing MFA.\n\n## Steps\n1. Decide the session duration the downstream task needs.\n2. If MFA is required, supply the MFA device serial number and the current token code.\n3. Call get session token to receive a temporary access key, secret key, and session token.\n4. Hand the temporary credentials to the step that needs them and let them expire naturally.\n\n## Output\nConfirm that a session token was issued and its expiration time. Never print the secret access key or session token value.',
    },
    {
      name: 'identify-access-key-owner',
      description:
        'Use AWS STS get access key info to resolve which account an access key ID belongs to. Use for incident triage of leaked or unexpected keys.',
      content:
        '# Identify Access Key Owner\n\nFind out which account owns an access key ID.\n\n## Steps\n1. Take the access key ID under investigation (for example, one found in a leak or an unexpected log).\n2. Call get access key info to resolve the owning AWS account ID.\n3. Compare the account against your known and expected accounts.\n4. If it belongs to an unexpected account, escalate for investigation.\n\n## Output\nReport the access key ID (never the secret) and its owning account ID, plus whether that account is expected.',
    },
  ],
} as const satisfies BlockMeta
