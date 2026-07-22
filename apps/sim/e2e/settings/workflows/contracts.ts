export const peopleWorkflowCases = [
  {
    caseId: 'workspace-new-invitation-lifecycle',
    actor: 'paidOrganizationOwner',
    workspaceKey: 'team-invitation-workspace',
  },
  {
    caseId: 'organization-new-invitation-lifecycle',
    actor: 'paidOrganizationOwner',
    workspaceKey: 'team-workspace',
  },
  {
    caseId: 'organization-real-member-lifecycle',
    actor: 'paidOrganizationOwner',
    subject: 'teamWorkflowMember',
  },
] as const

export const dynamicRestrictionCases = [
  {
    sectionId: 'secrets',
    label: 'Secrets',
    flag: 'hideSecretsTab',
    existingProofId: 'workspace-permission-group-secrets-denied',
  },
  {
    sectionId: 'apikeys',
    label: 'Sim API keys',
    flag: 'hideApiKeysTab',
    existingProofId: 'workspace-permission-group-apikeys-denied',
  },
  {
    sectionId: 'inbox',
    label: 'Sim mailer',
    flag: 'hideInboxTab',
    existingProofId: 'workspace-permission-group-inbox-denied',
  },
  {
    sectionId: 'mcp',
    label: 'MCP tools',
    flag: 'disableMcpTools',
    existingProofId: 'workspace-permission-group-mcp-denied',
  },
  {
    sectionId: 'custom-tools',
    label: 'Custom tools',
    flag: 'disableCustomTools',
    existingProofId: 'workspace-permission-group-custom-tools-denied',
  },
] as const

export const workflowPersonaKeys = ['teamWorkflowMember', 'enterpriseWorkflowMember'] as const
