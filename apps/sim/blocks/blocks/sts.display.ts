import { STSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const STSBlockDisplay = {
  type: 'sts',
  name: 'AWS STS',
  description: 'Connect to AWS Security Token Service',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: STSIcon,
  longDescription:
    'Integrate AWS STS into the workflow. Assume roles, get temporary credentials, verify caller identity, and look up access key information.',
  docsLink: 'https://docs.sim.ai/integrations/sts',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

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
