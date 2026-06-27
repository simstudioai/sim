import { IdentityCenterIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const IdentityCenterBlockDisplay = {
  type: 'identity_center',
  name: 'AWS Identity Center',
  description: 'Manage temporary elevated access in AWS IAM Identity Center',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IdentityCenterIcon,
  longDescription:
    'Provision and revoke temporary access to AWS accounts via IAM Identity Center (SSO). Assign permission sets to users or groups, look up users by email, and list accounts and permission sets for access request workflows.',
  docsLink: 'https://docs.sim.ai/integrations/identity_center',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const IdentityCenterBlockMeta = {
  tags: ['cloud', 'identity'],
  url: 'https://aws.amazon.com/iam/identity-center',
  templates: [
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center access-review',
      prompt:
        'Build a scheduled quarterly workflow that surfaces AWS Identity Center permission sets and group memberships, requests owner attestation in Slack, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center new-hire onboarder',
      prompt:
        'Create a workflow that on a Workday new-hire event provisions AWS Identity Center permission sets based on role, and writes the assignment to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center offboarder',
      prompt:
        'Build a workflow that on a Workday termination revokes the user’s AWS Identity Center assignments and writes the action log to the security audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center assignment monitor',
      prompt:
        'Create a scheduled workflow that snapshots AWS Identity Center account assignments and permission sets, flags new or broadened access, and pings the security Slack channel on changes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center permission-set drift',
      prompt:
        'Build a scheduled workflow that diffs AWS Identity Center permission sets against the Terraform source of truth, alerts on drift, and writes the report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center orphaned-access finder',
      prompt:
        'Create a scheduled workflow that lists AWS Identity Center account assignments, flags principals with stale or unexpected access, emails owners for confirmation, and writes the findings to a security dashboard table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: IdentityCenterIcon,
      title: 'Identity Center compliance reporter',
      prompt:
        'Build a scheduled workflow that produces an AWS Identity Center compliance report — permission sets, group memberships, and account assignments — and writes the file for auditors.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'grant-temporary-access',
      description:
        'Assign a permission set to a user or group on an AWS account through Identity Center and confirm the assignment completes. Use for just-in-time elevated access.',
      content:
        '# Grant Temporary Access\n\nProvision elevated access via an Identity Center account assignment.\n\n## Steps\n1. Resolve the Identity Center instance, target account, and permission set.\n2. Resolve the principal — get the user or group to confirm the correct ID and type.\n3. Create the account assignment for that principal, permission set, and account.\n4. Poll check assignment status until it reports SUCCEEDED.\n\n## Output\nConfirm the principal, account, permission set, and final assignment status. If it failed, surface the failure reason.',
    },
    {
      name: 'revoke-access',
      description:
        'Remove a permission set assignment from a user or group in Identity Center and confirm deletion. Use to wind down temporary or expired access.',
      content:
        '# Revoke Access\n\nRemove an account assignment to revoke access.\n\n## Steps\n1. List account assignments to confirm the principal currently holds the permission set on the account.\n2. Delete the account assignment for that principal, permission set, and account.\n3. Poll check assignment deletion status until it reports SUCCEEDED.\n4. Re-list assignments to verify the grant is gone.\n\n## Output\nConfirm what was revoked and the final deletion status. Note if the assignment did not exist.',
    },
    {
      name: 'access-audit-report',
      description:
        'Enumerate permission sets, group memberships, and account assignments in Identity Center to produce an access report. Use for compliance and periodic reviews.',
      content:
        '# Access Audit Report\n\nReport who has access to what across accounts.\n\n## Steps\n1. List instances and accounts to scope the report.\n2. List permission sets and, per account, list account assignments.\n3. Resolve users and groups behind each assignment with get user and get group.\n4. Compile assignments grouped by account and permission set.\n\n## Output\nAn access report: per account, which principals hold which permission sets, with anything unexpected flagged for review.',
    },
  ],
} as const satisfies BlockMeta
