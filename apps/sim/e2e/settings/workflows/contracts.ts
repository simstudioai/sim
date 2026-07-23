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

export const enterpriseIntegrationWorkflowCases = [
  {
    caseId: 'saml-provider-lifecycle',
    actor: 'enterpriseOrganizationAdmin',
    worldKey: 'settings-primary',
    organizationKey: 'enterprise-organization',
    routeTemplate: '/organization/{organizationId}/settings/sso',
    navigationContractId: 'organization-sso',
    navigationProofId: 'step3-enterprise-organization-positive',
    authorizationProofId: 'organization-read-member-sso-denied',
    lifecycle: [
      { method: 'POST', path: '/api/auth/sso/register', statuses: [200] },
      {
        method: 'POST',
        path: '/api/auth/sso/providers/{providerRowId}/domain-verification/request',
        statuses: [201],
      },
      { method: 'PATCH', path: '/api/auth/sso/providers/{providerRowId}', statuses: [200] },
      { method: 'DELETE', path: '/api/auth/sso/providers/{providerRowId}', statuses: [200] },
    ],
    safetyBoundary: 'pending-domain-verification-only',
  },
  {
    caseId: 'organization-retention-and-workspace-override-lifecycle',
    actor: 'enterpriseOrganizationAdmin',
    worldKey: 'settings-primary',
    organizationKey: 'enterprise-organization',
    workspaceKey: 'enterprise-workspace',
    routeTemplate: '/organization/{organizationId}/settings/data-retention',
    effectiveRouteTemplate: '/workspace/{workspaceId}/settings/data-retention',
    navigationContractId: 'organization-data-retention',
    navigationProofId: 'step3-enterprise-organization-positive',
    authorizationProofId: 'organization-read-member-data-retention-denied',
    lifecycle: [
      {
        method: 'GET',
        path: '/api/organizations/{organizationId}/data-retention',
        statuses: [200],
      },
      {
        method: 'PUT',
        path: '/api/organizations/{organizationId}/data-retention',
        statuses: [200],
      },
    ],
    safetyBoundary: 'omit-pii-and-restore-exact-configured-snapshot',
  },
  {
    caseId: 'mcp-server-discovery-lifecycle',
    actor: 'enterpriseOrganizationAdmin',
    worldKey: 'settings-primary',
    workspaceKey: 'enterprise-workspace',
    routeTemplate: '/workspace/{workspaceId}/settings/mcp',
    navigationContractId: 'workspace-mcp',
    navigationProofId: 'step3-enterprise-workspace-positive',
    authorizationProofId: 'workspace-permission-group-mcp-denied',
    lifecycle: [
      { method: 'POST', path: '/api/mcp/servers/test-connection', statuses: [200] },
      { method: 'POST', path: '/api/mcp/servers', statuses: [201, 200] },
      { method: 'PATCH', path: '/api/mcp/servers/{serverId}', statuses: [200] },
      { method: 'DELETE', path: '/api/mcp/servers', statuses: [200] },
    ],
    safetyBoundary: 'allowlisted-fake-discovery-without-auth-or-headers',
  },
] as const
