import { accessGateCases, existingNavigationProofs } from '../authorization/contracts'
import { sectionContracts } from '../navigation/contracts'
import { SETTINGS_PERSONA_KEYS } from '../personas'
import {
  dynamicRestrictionCases,
  enterpriseIntegrationWorkflowCases,
  peopleWorkflowCases,
  workflowPersonaKeys,
} from './contracts'
import { expect, test } from './workflow-test'

test('workflow contracts reference durable personas and authorization proofs', () => {
  const personaKeys = new Set<string>(SETTINGS_PERSONA_KEYS)
  const accessCaseIds = new Set(accessGateCases.map(({ caseId }) => caseId))

  expect(new Set(peopleWorkflowCases.map(({ caseId }) => caseId)).size).toBe(
    peopleWorkflowCases.length
  )
  expect(new Set(dynamicRestrictionCases.map(({ sectionId }) => sectionId)).size).toBe(
    dynamicRestrictionCases.length
  )
  for (const personaKey of workflowPersonaKeys) expect(personaKeys).toContain(personaKey)
  for (const restriction of dynamicRestrictionCases) {
    expect(accessCaseIds).toContain(restriction.existingProofId)
  }
})

test('Step 6b lifecycle contracts remain literal and self-contained', () => {
  expect(enterpriseIntegrationWorkflowCases).toEqual([
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
  ])
})

test('Step 6b lifecycle contracts reference durable navigation and authorization proofs', () => {
  const personaKeys = new Set<string>(SETTINGS_PERSONA_KEYS)
  const navigationContractIds = new Set(sectionContracts.map(({ contractId }) => contractId))
  const navigationProofIds = new Set(existingNavigationProofs.map(({ proofId }) => proofId))
  const authorizationProofIds = new Set(accessGateCases.map(({ caseId }) => caseId))

  expect(new Set(enterpriseIntegrationWorkflowCases.map(({ caseId }) => caseId)).size).toBe(
    enterpriseIntegrationWorkflowCases.length
  )
  for (const workflowCase of enterpriseIntegrationWorkflowCases) {
    expect(personaKeys).toContain(workflowCase.actor)
    expect(navigationContractIds).toContain(workflowCase.navigationContractId)
    expect(navigationProofIds).toContain(workflowCase.navigationProofId)
    expect(authorizationProofIds).toContain(workflowCase.authorizationProofId)
    expect(
      sectionContracts.find(({ contractId }) => contractId === workflowCase.navigationContractId)
        ?.pathTemplate
    ).toBe(workflowCase.routeTemplate)
    expect(
      accessGateCases.find(({ caseId }) => caseId === workflowCase.authorizationProofId)
        ?.pathTemplate
    ).toBe(workflowCase.routeTemplate)
  }
})
