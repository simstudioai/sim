import { ClerkIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ClerkBlockDisplay = {
  type: 'clerk',
  name: 'Clerk',
  description: 'Manage users, organizations, and sessions in Clerk',
  category: 'tools',
  bgColor: '#131316',
  icon: ClerkIcon,
  longDescription:
    'Integrate Clerk authentication and user management into your workflow. Create, update, delete, and list users. Manage organizations and their memberships. Monitor and control user sessions.',
  docsLink: 'https://docs.sim.ai/integrations/clerk',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const ClerkBlockMeta = {
  tags: ['identity', 'automation'],
  url: 'https://clerk.com',
  templates: [
    {
      icon: ClerkIcon,
      title: 'Clerk new-signup pipeline',
      prompt:
        'Build a scheduled workflow that lists recent Clerk users, creates each new signup in HubSpot with the right lifecycle stage, and enrolls them in a Loops onboarding sequence.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['hubspot', 'loops'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk MFA enrollment chaser',
      prompt:
        'Create a scheduled workflow that finds Clerk users without MFA enrolled in 30 days, sends in-app prompts via Loops, and writes enrollment progress to a security dashboard.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk session anomaly watcher',
      prompt:
        'Build a scheduled workflow that lists recent Clerk sessions, flags unusual patterns — impossible travel, repeated login failures — and pings the security Slack channel on real threats.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk org-management automator',
      prompt:
        'Create a workflow that on a new enterprise plan via Stripe creates a Clerk organization, invites the admin, and writes the Clerk org ID back to the Stripe customer.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk inactive-user cleaner',
      prompt:
        'Build a scheduled workflow that finds Clerk users with no sign-ins in 180 days, sends a re-engagement email, and removes accounts after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk access-review automator',
      prompt:
        'Create a scheduled quarterly workflow that lists Clerk organizations and their users, requires owner re-attestation, and writes the review trail to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ClerkIcon,
      title: 'Clerk user roster archiver',
      prompt:
        'Build a scheduled workflow that exports the full Clerk user and organization roster to S3 on a retention schedule, and writes the snapshot manifest to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
  ],
  skills: [
    {
      name: 'find-user',
      description:
        'Look up a Clerk user by email, username, or name and return their profile. Use to resolve a user before acting on their account or syncing them elsewhere.',
      content:
        '# Find User\n\nLocate a Clerk user account.\n\n## Steps\n1. Use List Users with a Search Query (matches email, phone, username, or name), or the email/username filters for an exact match.\n2. If you already have the Clerk user id (user_...), use Get User instead for the full record.\n3. Review the returned profile: id, primary email, name, externalId, and flags like banned, locked, and twoFactorEnabled.\n\n## Output\nReturn the matched user id, primary email, name, and key status flags. If multiple users match, list the candidates with their emails so the right one can be confirmed; if none match, say so.',
    },
    {
      name: 'provision-user',
      description:
        'Create or update a Clerk user with email, name, and metadata. Use to onboard a user or sync profile changes from another system into Clerk.',
      content:
        '# Provision User\n\nCreate or update a Clerk user.\n\n## Steps\n1. To create, use Create User with at least an email address (and optionally phone, username, password, first/last name).\n2. To set application roles or app data, pass Public Metadata (visible to the frontend) and Private Metadata (server-only) as JSON.\n3. Set External ID to link the Clerk user to your own system id.\n4. To modify an existing user, use Update User with the user id and only the fields that change.\n\n## Output\nReturn the user id, primary email, and the metadata that was set. Confirm whether the user was created or updated. If a required field is missing or the email already exists, report it clearly.',
    },
    {
      name: 'audit-user-sessions',
      description:
        'List and inspect a Clerk user active sessions and revoke suspicious ones. Use for security review or forced sign-out.',
      content:
        '# Audit User Sessions\n\nReview and control Clerk sessions.\n\n## Steps\n1. Use List Sessions filtered by user id and status (e.g. active) to see current sessions.\n2. For a specific session, use Get Session to read its details: client, status, lastActiveAt.\n3. Identify sessions that look risky (stale, unexpected client, or flagged by your own logic).\n4. Use Revoke Session with the session id to force sign-out of any session that should not continue.\n\n## Output\nReturn the list of sessions reviewed with status and last-active time, and the ids of any sessions revoked. Summarize the action taken so the security trail is clear.',
    },
    {
      name: 'manage-organization',
      description:
        'Create a Clerk organization or look up its details and membership. Use when provisioning a new team or tenant in a multi-tenant app.',
      content:
        '# Manage Organization\n\nCreate or inspect a Clerk organization.\n\n## Steps\n1. To create, use Create Organization with the organization name and the Creator User ID (that user becomes the admin); optionally set a slug and max members.\n2. To inspect, use Get Organization by org id or slug, or List Organizations with a search query and include members count.\n3. Read back the org id, slug, members count, and limits.\n\n## Output\nReturn the organization id, name, slug, and member count. When creating, confirm the admin user and echo the org id so it can be linked back to your billing or CRM record.',
    },
  ],
} as const satisfies BlockMeta
