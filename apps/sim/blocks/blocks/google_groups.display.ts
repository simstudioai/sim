import { GoogleGroupsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleGroupsBlockDisplay = {
  type: 'google_groups',
  name: 'Google Groups',
  description: 'Manage Google Workspace Groups and their members',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleGroupsIcon,
  longDescription:
    'Connect to Google Workspace to create, update, and manage groups and their members using the Admin SDK Directory API.',
  docsLink: 'https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const GoogleGroupsBlockMeta = {
  tags: ['google-workspace', 'messaging', 'identity'],
  url: 'https://groups.google.com',
  templates: [
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups onboarding sync',
      prompt:
        'Create a workflow that watches Rippling or Greenhouse for new hires, adds them to the right Google Groups based on team and department, and emails the new hire a list of the groups joined.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['rippling', 'greenhouse'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups quarterly access review',
      prompt:
        'Build a scheduled workflow that runs each quarter, lists every Google Group with members and owners, writes the report to a table for compliance review, and pings owners to confirm membership in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups departure cleanup',
      prompt:
        'Create a workflow that watches Workday or Rippling for terminations and removes the departing user from every Google Group they belonged to, writing the change to a security audit log.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday', 'rippling'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups self-serve requester',
      prompt:
        'Build a workflow that accepts a Google Group access request via a form, gets manager approval over Slack, adds the user to the group, and notifies the requester when access is granted.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups distribution-list audit',
      prompt:
        'Create a scheduled workflow that scans Google Groups marked as distribution lists, flags external members against an allowlist, and posts a Slack report to the security team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups empty-group cleanup',
      prompt:
        'Build a scheduled workflow that lists Google Groups with no members, opens a confirmation thread with the owner in Slack, and deletes the group once approved.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleGroupsIcon,
      title: 'Google Groups settings hardening',
      prompt:
        'Create a scheduled workflow that reads the settings for every Google Group, flags groups that allow external posting or open membership against policy, and posts the findings to the security team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'add-member-to-group',
      description:
        'Add a user to a Google Workspace group with a chosen role and confirm membership.',
      content:
        '# Add a Member to a Group\n\nGrant someone membership in a Workspace group.\n\n## Steps\n1. Identify the group email or ID and the member email.\n2. Run Check Membership first to see if the user is already a member; skip the add if so.\n3. Run Add Member with the member email and the desired role (MEMBER, MANAGER, or OWNER; default MEMBER).\n4. Optionally run Check Membership again to confirm the add succeeded.\n\n## Output\nConfirm the user was added (or already present), the role granted, and the group. Note if the operation requires admin privileges that were missing.',
    },
    {
      name: 'audit-group-membership',
      description: 'List the members and roles of a Google Group for access review or compliance.',
      content:
        '# Audit Group Membership\n\nProduce a membership roster for a group.\n\n## Steps\n1. Identify the group email or ID.\n2. Run List Members with a Max Results value; optionally filter by roles (OWNER, MANAGER, MEMBER).\n3. Page through results using the next page token until all members are collected.\n4. Separate owners/managers from regular members and flag any external-domain addresses.\n\n## Output\nA roster grouped by role: owners, managers, members. Include total counts and a list of any external members for review.',
    },
    {
      name: 'create-group',
      description: 'Create a new Google Workspace group with an email, name, and description.',
      content:
        '# Create a Group\n\nStand up a new Workspace group.\n\n## Steps\n1. Decide the group email address, display name, and a clear description of its purpose.\n2. Run List Groups (filter by the intended email/name) to confirm it does not already exist.\n3. Run Create Group with the email, name, and description.\n4. Optionally run Add Member to seed initial owners/managers.\n\n## Output\nConfirm the created group with its email, name, and description. List any initial members added. Note that this requires Workspace admin access.',
    },
    {
      name: 'remove-member-from-group',
      description: 'Remove a user from a Google Group, useful for offboarding and access cleanup.',
      content:
        "# Remove a Member from a Group\n\nRevoke a user's group membership.\n\n## Steps\n1. Identify the group email/ID and the member email or ID.\n2. Run Check Membership to confirm the user is actually a member.\n3. If present, run Remove Member with the group and member keys.\n4. For offboarding across many groups, run List Groups filtered by `memberKey:<email>` first to find every group the user belongs to, then remove from each.\n\n## Output\nConfirm the removal per group, and for offboarding list every group the user was removed from. Note any failures for manual follow-up.",
    },
  ],
} as const satisfies BlockMeta
