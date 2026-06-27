import { OktaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const OktaBlockDisplay = {
  type: 'okta',
  name: 'Okta',
  description: 'Manage users and groups in Okta',
  category: 'tools',
  bgColor: '#191919',
  icon: OktaIcon,
  iconColor: '#007DC1',
  longDescription:
    'Integrate Okta identity management into your workflow. List, create, update, activate, suspend, and delete users. Reset passwords. Manage groups and group membership.',
  docsLink: 'https://docs.sim.ai/integrations/okta',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const OktaBlockMeta = {
  tags: ['identity', 'automation'],
  url: 'https://www.okta.com',
  templates: [
    {
      icon: OktaIcon,
      title: 'Okta quarterly access review',
      prompt:
        'Build a scheduled quarterly workflow that pulls Okta group memberships per app, posts an attestation thread to each owner in Slack, captures confirmations, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OktaIcon,
      title: 'Okta orphan-account sweeper',
      prompt:
        'Create a scheduled workflow that compares Okta users against HRIS data, finds accounts for departed employees, disables them, and writes the sweep log to an audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OktaIcon,
      title: 'Okta new-hire provisioning',
      prompt:
        'Build a workflow that polls Workday for new hires, creates the matching Okta user, adds them to the right groups for their role, and emails IT a provisioning summary.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday', 'gmail'],
    },
    {
      icon: OktaIcon,
      title: 'Okta compromised-account responder',
      prompt:
        'Create a workflow triggered by a CrowdStrike detection on a user that suspends the matching Okta account, resets their password, and pings the security Slack channel with the action taken.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['crowdstrike', 'slack'],
    },
    {
      icon: OktaIcon,
      title: 'Okta access-group provisioner',
      prompt:
        'Build a workflow that reads an access-request table, creates the Okta group if it is missing, adds the approved users to it, and writes the grant record back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: OktaIcon,
      title: 'Okta SSO group sync',
      prompt:
        'Create a scheduled workflow that mirrors org structure from Workday into Okta groups, ensuring group memberships stay in sync as employees change roles.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'sync'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OktaIcon,
      title: 'Okta group membership audit',
      prompt:
        'Build a scheduled monthly workflow that lists every Okta group and its members, flags privileged groups with unexpected membership, and writes a review report for the security team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'onboard-user',
      description: 'Create an Okta user, set their profile, and add them to the right groups.',
      content:
        '# Onboard User\n\nProvision a new user in Okta and grant their group access.\n\n## Steps\n1. Run Create User with the profile fields: first name, last name, email, and login.\n2. Determine the groups the role requires, using List Groups to resolve group ids.\n3. Run Add User to Group for each required group.\n4. Activate the user if it was created in a staged state.\n\n## Output\nConfirm the new user id and login, and list the groups they were added to.',
    },
    {
      name: 'offboard-user',
      description: 'Deactivate an Okta user and remove their group memberships during offboarding.',
      content:
        '# Offboard User\n\nRevoke access for a departing user in Okta.\n\n## Steps\n1. Find the user with List Users or Get User to confirm the user id.\n2. Run Deactivate User (or Suspend User for a temporary hold) to block sign-in.\n3. Remove the user from sensitive groups with Remove User from Group.\n4. Only run Delete User when permanent removal is explicitly requested, since it is irreversible.\n\n## Output\nConfirm the user status and the groups removed. State clearly whether the account was deactivated or deleted.',
    },
    {
      name: 'audit-group-membership',
      description: 'List Okta groups and their members to audit access for a security review.',
      content:
        '# Audit Group Membership\n\nReview who belongs to Okta groups, focusing on privileged access.\n\n## Steps\n1. Run List Groups to enumerate the groups, or Get Group for a specific one.\n2. For each group of interest, run List Group Members.\n3. Highlight privileged or admin groups and call out any unexpected members.\n\n## Output\nA per-group roster with member counts, and a short list of access concerns to review.',
    },
    {
      name: 'reset-user-password',
      description: 'Trigger an Okta password reset for a user who is locked out.',
      content:
        '# Reset User Password\n\nHelp a user regain access by resetting their Okta password.\n\n## Steps\n1. Locate the user with Get User to confirm identity.\n2. Run Reset Password to start the reset flow for that user.\n3. If the account is suspended, run Unsuspend User first so the reset can proceed.\n\n## Output\nConfirm the reset was initiated for the named user and note any prerequisite step that was taken.',
    },
  ],
} as const satisfies BlockMeta
