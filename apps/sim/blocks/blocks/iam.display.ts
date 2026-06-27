import { IAMIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const IAMBlockDisplay = {
  type: 'iam',
  name: 'AWS IAM',
  description: 'Manage AWS IAM users, roles, policies, and groups',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IAMIcon,
  longDescription:
    'Integrate AWS Identity and Access Management into your workflow. Create and manage users, roles, policies, groups, and access keys.',
  docsLink: 'https://docs.sim.ai/integrations/iam',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const IAMBlockMeta = {
  tags: ['cloud', 'identity'],
  url: 'https://aws.amazon.com/iam',
  templates: [
    {
      icon: IAMIcon,
      title: 'IAM permission drift detector',
      prompt:
        'Build a scheduled workflow that diffs AWS IAM policies against the Terraform source of truth, alerts on drift, and writes the drift report to a security Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IAMIcon,
      title: 'IAM wildcard policy auditor',
      prompt:
        'Create a scheduled workflow that scans AWS IAM policies for wildcard permissions, scores each by blast radius, and writes a remediation queue to a security table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: IAMIcon,
      title: 'IAM access-review automator',
      prompt:
        'Build a scheduled quarterly workflow that posts AWS IAM access-review requests to role owners in Slack, captures attestations, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IAMIcon,
      title: 'IAM stale-key sweeper',
      prompt:
        'Create a scheduled workflow that reviews IAM users for aged access keys, notifies the owner via Slack, and rotates the key with a fresh one or removes it after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IAMIcon,
      title: 'IAM unused-role cleaner',
      prompt:
        'Build a scheduled monthly workflow that finds IAM roles with no recent activity, requires owner approval in Slack, and removes the role to reduce attack surface.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IAMIcon,
      title: 'IAM least-privilege recommender',
      prompt:
        'Create a workflow that simulates IAM principal policies against expected actions, generates least-privilege policy suggestions for over-permissioned roles, and opens Linear tickets for engineers to apply.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: IAMIcon,
      title: 'IAM policy guardrail watcher',
      prompt:
        'Build a scheduled workflow that snapshots AWS IAM managed policies and role attachments, classifies risk on each change, and pings the security team in Slack when a change broadens permissions.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'audit-iam-permissions',
      description:
        'List IAM users, roles, and their attached policies to produce an access audit. Use for security reviews and least-privilege checks.',
      content:
        '# Audit IAM Permissions\n\nReport who and what has access in IAM.\n\n## Steps\n1. List users and roles to establish the inventory.\n2. For each principal of interest, list attached user or role policies.\n3. Optionally simulate principal policy to confirm whether a principal can perform sensitive actions.\n4. Flag overly broad policies, unused principals, or access keys that should be rotated.\n\n## Output\nAn audit summary: principals and their attached policies, with risky or excessive grants called out. Do not expose secret values.',
    },
    {
      name: 'check-effective-permissions',
      description:
        'Use IAM policy simulation to verify whether a user or role can perform specific actions on resources. Use for troubleshooting access and validating changes.',
      content:
        '# Check Effective Permissions\n\nDetermine whether a principal is actually allowed to do something.\n\n## Steps\n1. Identify the principal (user or role) and the actions and resource ARNs to test.\n2. Run simulate principal policy for those actions against the resources.\n3. Read the allowed or denied decision for each action, noting which statement governs it.\n4. If denied unexpectedly, inspect the attached policies to explain why.\n\n## Output\nA per-action allow/deny verdict with the governing policy, and a plain-language explanation of any denial.',
    },
    {
      name: 'provision-iam-principal',
      description:
        'Create an IAM user or role, attach managed policies, and place users into groups to grant scoped access. Use for onboarding and standing up service roles.',
      content:
        '# Provision IAM Principal\n\nStand up a new IAM user or role with the right permissions.\n\n## Steps\n1. Decide whether to create a user (for a person or app) or a role (for a service or cross-account access).\n2. For a user, create the user, then add them to the relevant groups or attach the needed managed policy ARNs. For a role, create the role with a trust policy that names the allowed principal, then attach the policy ARNs.\n3. Prefer attaching existing managed policies over broad wildcards; grant only the actions required.\n4. Confirm the result by listing the attached user or role policies.\n\n## Output\nReport the created principal name and ARN and the policies now attached. Do not print any generated secret values.',
    },
    {
      name: 'rotate-access-keys',
      description:
        'Create a fresh IAM access key for a user and delete the old one to complete a safe rotation. Use for scheduled key rotation and remediating aged keys.',
      content:
        '# Rotate Access Keys\n\nReplace a user’s access key following the two-step rotation pattern.\n\n## Steps\n1. Create a new access key for the target user so two keys exist briefly.\n2. Hand the new key to its consumer securely and let dependents switch over and verify they still work.\n3. Once the new key is confirmed in use, delete the old access key by its ID.\n4. Confirm only the intended key remains for the user.\n\n## Output\nReport the user, that a new key was issued, and the old key ID that was deleted. Never print the secret access key value — reference keys only by their access key ID.',
    },
  ],
} as const satisfies BlockMeta
