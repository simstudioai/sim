import { AzureIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MicrosoftAdBlockDisplay = {
  type: 'microsoft_ad',
  name: 'Azure AD',
  description: 'Manage users and groups in Azure AD (Microsoft Entra ID)',
  category: 'tools',
  bgColor: '#0078D4',
  icon: AzureIcon,
  longDescription:
    'Integrate Azure Active Directory into your workflows. List, create, update, and delete users and groups. Manage group memberships programmatically.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_ad',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const MicrosoftAdBlockMeta = {
  tags: ['identity', 'microsoft-365'],
  url: 'https://www.microsoft.com/security/business/identity-access/microsoft-entra-id',
  templates: [
    {
      icon: AzureIcon,
      title: 'Azure AD provisioning',
      prompt:
        'Build a workflow that on a Workday new-hire event creates the Azure AD user account, assigns the right group memberships, and writes the provisioning record to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD offboarding sweep',
      prompt:
        'Create a workflow that on a Workday termination disables the Azure AD account, removes its group memberships, and writes the security audit record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD access review',
      prompt:
        'Build a scheduled quarterly workflow that lists Azure AD group memberships, requests owner attestation in Microsoft Teams, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD password-age reminder',
      prompt:
        'Create a scheduled workflow that lists Azure AD users, flags accounts whose last password change is older than the policy window, sends targeted reset reminders, and writes the compliance audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD stale-account sweeper',
      prompt:
        'Build a scheduled workflow that lists Azure AD accounts inactive for 90+ days, requests owner re-attestation, and disables accounts that fail attestation.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD privileged-group auditor',
      prompt:
        'Create a scheduled monthly workflow that lists the members of privileged Azure AD groups, requests owner attestation for each, and writes the review to an audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD privileged-access monitor',
      prompt:
        'Build a scheduled workflow that lists privileged Azure AD group members each run, compares against the last snapshot in a table, and pings the security Microsoft Teams channel on any add or removal.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'provision-new-user',
      description:
        'Create a new Azure AD (Entra ID) user account and add it to the right groups. Use when onboarding an employee or contractor.',
      content:
        '# Provision New User\n\nCreate an Azure AD user and grant initial group access.\n\n## Steps\n1. Use Create User with the required fields: display name, mail nickname, user principal name (e.g. name@yourdomain.com), and an initial password. Set Account Enabled to Yes.\n2. Fill optional profile fields when available: first name, last name, job title, department, office location, and mobile phone.\n3. For each group the person should belong to, resolve the group with Get Group or List Groups, then call Add Group Member with the new user id.\n4. Confirm membership with List Group Members.\n\n## Output\nReturn the created user id, user principal name, and the list of groups they were added to. If a username collision or password-policy error occurs, report it clearly instead of retrying blindly.',
    },
    {
      name: 'offboard-user',
      description:
        'Disable an Azure AD account and strip its group memberships when someone leaves. Use for secure offboarding.',
      content:
        '# Offboard User\n\nRevoke access for a departing user.\n\n## Steps\n1. Resolve the account with Get User by user principal name or id.\n2. Use Update User to set Account Enabled to No so the user can no longer sign in.\n3. Use List Group Members or the user record to enumerate the groups the user belongs to.\n4. For each group, call Remove Group Member with the user id.\n\n## Output\nReturn the disabled user id and the list of groups the user was removed from. Note any group where removal failed so it can be handled manually, and recommend writing the action to an audit record.',
    },
    {
      name: 'audit-group-membership',
      description:
        'List the members of an Azure AD group for an access review. Use for periodic attestation of privileged or sensitive groups.',
      content:
        '# Audit Group Membership\n\nProduce a current membership snapshot for a group.\n\n## Steps\n1. Resolve the target group with Get Group or List Groups (filter or search by name).\n2. Call List Group Members for the group id, raising Max Results if the group is large.\n3. For each member, optionally call Get User to enrich with job title, department, and account-enabled status.\n\n## Output\nReturn a table of members with id, display name, email, department, and whether the account is enabled. Highlight disabled or stale accounts that still hold membership and should be reviewed for removal.',
    },
  ],
} as const satisfies BlockMeta
