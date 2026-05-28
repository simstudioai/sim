import type {
  WorkspaceCredential,
  WorkspaceCredentialMember,
} from '@/lib/api/contracts/credentials'

/**
 * Flip to `true` to preview the Connected section on the workspace
 * integrations page with the sample data below. Leave `false` for shipping.
 */
export const PREVIEW_CONNECTED_WITH_SAMPLES = true

/**
 * Realistic `WorkspaceCredential` rows used to preview the Connected section
 * without requiring real OAuth connections. Activated via the
 * `PREVIEW_CONNECTED_WITH_SAMPLES` flag above.
 *
 * Each entry exercises a distinct rendering path:
 * - Slack:   description present → renders as-is
 * - Gmail:   description `null`  → falls back to "Gmail integration"
 * - Jira:    description `""`    → falls back to "Jira integration"
 * - Notion:  description present, role `member`
 */
export function getSampleConnectedCredentials(
  workspaceId: string,
  userId: string
): WorkspaceCredential[] {
  const now = new Date().toISOString()
  const base = {
    workspaceId,
    envKey: null,
    envOwnerUserId: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    status: 'active' as const,
  }
  return [
    {
      ...base,
      id: 'sample-slack',
      type: 'oauth',
      displayName: "Emir's Slack",
      description: 'Workspace alerts and on-call routing',
      providerId: 'slack',
      accountId: 'sample-slack-account',
      role: 'admin',
    },
    {
      ...base,
      id: 'sample-gmail',
      type: 'oauth',
      displayName: 'Personal Gmail',
      description: null,
      providerId: 'google-email',
      accountId: 'sample-gmail-account',
      role: 'admin',
    },
    {
      ...base,
      id: 'sample-jira',
      type: 'oauth',
      displayName: 'Engineering Jira',
      description: '',
      providerId: 'jira',
      accountId: 'sample-jira-account',
      role: 'member',
    },
    {
      ...base,
      id: 'sample-notion',
      type: 'oauth',
      displayName: 'Team Notion',
      description: 'Docs, runbooks, and meeting notes',
      providerId: 'notion',
      accountId: 'sample-notion-account',
      role: 'member',
    },
  ]
}

/**
 * Returns sample members for a given sample credential id. Used by the
 * credential-detail preview to demonstrate the Members section without a
 * real workspace. Returns `[]` for any non-sample id.
 */
export function getSampleConnectedMembers(credentialId: string): WorkspaceCredentialMember[] {
  if (credentialId !== 'sample-slack') return []
  const now = new Date().toISOString()
  return [
    {
      id: 'sample-slack-member-1',
      userId: 'sample-user-emir',
      role: 'admin',
      status: 'active',
      joinedAt: now,
      invitedBy: null,
      createdAt: now,
      updatedAt: now,
      userName: 'Emir Karabeg',
      userEmail: 'emir@sim.ai',
      userImage: null,
    },
  ]
}
