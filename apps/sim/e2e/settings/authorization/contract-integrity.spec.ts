import { expect, test } from '@playwright/test'
import {
  type AuthenticatedDriver,
  personaVisibilityCases,
  routeCases,
  sectionContracts,
} from '../navigation/contracts'
import { createSettingsPersonaScenarios, SETTINGS_PERSONA_KEYS } from '../personas'
import { accessGateCases, existingNavigationProofs, mutationControlCases } from './contracts'

const scenario = createSettingsPersonaScenarios('authorization-contract').primary
const personas = new Map(scenario.personas.map((persona) => [persona.key, persona]))
const workspaces = new Set(scenario.workspaces.map(({ key }) => key))
const organizations = new Set(scenario.organizations.map(({ key }) => key))

test('authorization contracts have stable unique identities and semantic probes', () => {
  expectUnique(
    accessGateCases.map(({ caseId }) => caseId),
    'access caseId'
  )
  expectUnique(
    mutationControlCases.map(({ caseId }) => caseId),
    'mutation caseId'
  )
  expectUnique(
    existingNavigationProofs.map(({ proofId }) => proofId),
    'existing proofId'
  )

  for (const accessCase of accessGateCases) {
    expect(accessCase.outcome.kind, `${accessCase.caseId} outcome`).toBeTruthy()
    assertCanonicalPath(accessCase.pathTemplate, accessCase.plane, accessCase.caseId)
    assertScenarioBinding(accessCase.driver, accessCase.caseId, accessCase.outcome.kind)
    if (accessCase.sidebar.existingProofId) {
      expect(
        existingNavigationProofs.some(
          ({ proofId }) => proofId === accessCase.sidebar.existingProofId
        ),
        `${accessCase.caseId} sidebar proof`
      ).toBe(true)
    } else if (accessCase.sidebar.state !== 'absent-shell') {
      expect(accessCase.sidebar.label, `${accessCase.caseId} sidebar label`).toBeTruthy()
    }
    if (accessCase.outcome.kind === 'render') {
      expect(accessCase.outcome.readiness, `${accessCase.caseId} readiness`).toBeTruthy()
      expect(accessCase.outcome.heading, `${accessCase.caseId} heading`).not.toBe('')
    }
    if (accessCase.outcome.kind === 'locked-render') {
      expect(accessCase.sidebar.state, accessCase.caseId).toBe('locked')
      expect(accessCase.outcome.readiness, `${accessCase.caseId} locked readiness`).toBeTruthy()
    }
  }

  for (const mutationCase of mutationControlCases) {
    assertCanonicalPath(
      mutationCase.pathTemplate,
      planeForPath(mutationCase.pathTemplate),
      mutationCase.caseId
    )
    assertScenarioBinding(mutationCase.driver, mutationCase.caseId, 'render')
    expect(mutationCase.readiness, `${mutationCase.caseId} readiness`).toBeTruthy()
    expect(mutationCase.controls.length, `${mutationCase.caseId} controls`).toBeGreaterThan(0)
    expectUnique(
      mutationCase.controls.map(({ probeId }) => probeId),
      `${mutationCase.caseId} probeId`
    )
    if (mutationCase.openDialogWith) {
      expect(
        mutationCase.controls.some(({ scope }) => scope.kind === 'dialog'),
        `${mutationCase.caseId} dialog-scoped probe`
      ).toBe(true)
    }
    for (const probe of mutationCase.controls) {
      expect(probe.control.name, `${mutationCase.caseId}/${probe.probeId} control name`).not.toBe(
        ''
      )
      expect(
        ['enabled', 'disabled', 'absent', 'present'],
        `${mutationCase.caseId}/${probe.probeId} expectation`
      ).toContain(probe.expectation)
    }
  }
})

test('Step 3 proof references resolve without rerunning their cases', () => {
  const referenceIds = {
    'section-contract': new Set<string>(sectionContracts.map(({ contractId }) => contractId)),
    'route-case': new Set<string>(routeCases.map(({ caseId }) => caseId)),
    'visibility-case': new Set<string>(personaVisibilityCases.map(({ caseId }) => caseId)),
  }

  for (const proof of existingNavigationProofs) {
    expect(referenceIds[proof.source].has(proof.referenceId), proof.proofId).toBe(true)
    expect(proof.owns, `${proof.proofId} ownership`).not.toBe('')
  }

  expect(existingNavigationProofs.map(({ proofId }) => proofId)).toEqual([
    'step3-organization-non-member-boundary',
    'step3-organization-member-billing-denial',
    'step3-account-platform-admin-positive',
    'step3-workspace-platform-admin-positive',
    'step3-max-inbox-positive',
    'step3-enterprise-organization-positive',
    'step3-enterprise-workspace-positive',
    'step3-permission-group-sidebar',
  ])
})

test('access contracts declare every required Step 4 gate axis', () => {
  expectSections(
    accessGateCases.filter(({ caseId }) => caseId.startsWith('organization-read-member-')),
    ['access-control', 'audit-logs', 'sso', 'data-retention', 'data-drains', 'whitelabeling']
  )
  expectSections(
    accessGateCases.filter(
      ({ caseId }) =>
        caseId.startsWith('organization-lapsed-owner-') && caseId.endsWith('-plan-denied')
    ),
    ['access-control', 'audit-logs', 'sso', 'data-retention', 'data-drains', 'whitelabeling']
  )
  expectSections(
    accessGateCases.filter(({ caseId }) => caseId.startsWith('workspace-member-')),
    [
      'organization',
      'billing',
      'access-control',
      'audit-logs',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
    ]
  )
  expectSections(
    accessGateCases.filter(({ caseId }) => caseId.startsWith('workspace-team-owner-')),
    [
      'access-control',
      'audit-logs',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
      'forks',
      'custom-blocks',
    ]
  )
  expectSections(
    accessGateCases.filter(({ caseId }) => caseId.startsWith('workspace-permission-group-')),
    ['secrets', 'apikeys', 'inbox', 'mcp', 'custom-tools']
  )

  for (const requiredId of [
    'account-personal-paid-billing',
    'account-non-platform-admin-denied',
    'account-non-platform-mothership-denied',
    'organization-lapsed-owner-members',
    'organization-lapsed-owner-billing',
    'organization-team-owner-billing',
    'workspace-foreign-access-denied',
    'workspace-external-admin-organization-denied',
    'workspace-external-admin-billing-denied',
    'workspace-enterprise-billing',
    'workspace-personal-paid-inbox-locked',
    'workspace-personal-paid-billing',
    'workspace-non-platform-admin-denied',
    'workspace-non-platform-mothership-denied',
  ]) {
    expect(
      accessGateCases.some(({ caseId }) => caseId === requiredId),
      requiredId
    ).toBe(true)
  }
})

test('mutation contracts declare every required section and role boundary', () => {
  const requiredWorkspaceSections = [
    'secrets',
    'custom-tools',
    'mcp',
    'workflow-mcp-servers',
    'teammates',
    'byok',
    'recently-deleted',
    'apikeys',
    'inbox',
    'forks',
    'custom-blocks',
  ]
  const workspaceSections = new Set(
    mutationControlCases
      .filter(({ pathTemplate }) => pathTemplate.startsWith('/workspace/'))
      .map(({ pathTemplate }) => pathTemplate.split('/').at(-1))
  )
  for (const section of requiredWorkspaceSections) {
    expect(workspaceSections.has(section), `workspace mutation section ${section}`).toBe(true)
  }

  for (const section of [
    'secrets',
    'custom-tools',
    'mcp',
    'workflow-mcp-servers',
    'teammates',
    'byok',
    'recently-deleted',
    'apikeys',
  ]) {
    const personas = mutationControlCases
      .filter(({ pathTemplate }) => pathTemplate.endsWith(`/settings/${section}`))
      .map(({ driver }) => driver.personaKey)
    expect(new Set(personas), `${section} read/write/admin matrix`).toEqual(
      new Set(['workspaceReadMember', 'workspaceWriteMember', 'workspaceAdminMember'])
    )
  }

  expect(
    mutationControlCases.some(
      ({ caseId, pathTemplate }) =>
        caseId === 'organization-member-members-controls' &&
        pathTemplate.endsWith('/settings/members')
    )
  ).toBe(true)
  expect(
    mutationControlCases.some(
      ({ caseId, pathTemplate }) =>
        caseId === 'organization-enterprise-access-control-create' &&
        pathTemplate.endsWith('/settings/access-control')
    )
  ).toBe(true)
})

test('Step 4 paths stay canonical and separate from Step 3 special paths', () => {
  const paths = [
    ...accessGateCases.map(({ pathTemplate }) => pathTemplate),
    ...mutationControlCases.map(({ pathTemplate }) => pathTemplate),
  ]
  for (const path of paths) {
    expect(path, 'workspace API-key alias belongs to Step 3').not.toMatch(
      /^\/workspace\/\{workspaceId\}\/settings\/api-keys$/
    )
    expect(path, 'base settings redirects belong to Step 3').not.toMatch(/\/settings$/)
    expect(path, 'unknown sections belong to Step 3').not.toContain('not-a-section')
    expect(path, 'integration redirect belongs to Step 3').not.toContain('/settings/integrations')
    expect(path, 'skills redirect belongs to Step 3').not.toContain('/settings/skills')
  }
})

function assertCanonicalPath(pathTemplate: string, plane: string, label: string): void {
  expect(pathTemplate.startsWith('/'), `${label} absolute path`).toBe(true)
  expect(pathTemplate.includes('?'), `${label} path without query`).toBe(false)
  if (plane === 'account') {
    expect(pathTemplate, `${label} account path`).toMatch(/^\/account\/settings\/[a-z-]+$/)
  } else {
    expect(pathTemplate, `${label} dynamic ${plane} path`).toMatch(
      new RegExp(`^/${plane}/\\{${plane}Id\\}/settings/[a-z-]+$`)
    )
  }
}

function assertScenarioBinding(
  driver: AuthenticatedDriver,
  label: string,
  outcomeKind: string
): void {
  expect(
    new Set<string>(SETTINGS_PERSONA_KEYS).has(driver.personaKey),
    `${label} persona key`
  ).toBe(true)
  const persona = personas.get(driver.personaKey)
  expect(persona, `${label} persona`).toBeTruthy()
  if (!driver.binding) return

  expect(driver.binding.worldKey, `${label} world`).toBe('settings-primary')
  if (driver.binding.resourceKind === 'workspace') {
    expect(workspaces.has(driver.binding.resourceKey), `${label} workspace`).toBe(true)
    const expectation = persona?.workspaces.find(
      ({ workspaceKey }) => workspaceKey === driver.binding?.resourceKey
    )
    expect(expectation, `${label} persona workspace binding`).toBeTruthy()
    if (outcomeKind === 'workspace-access-denied') {
      expect(expectation?.access, `${label} denied workspace access`).toBe('none')
    } else {
      expect(expectation?.access, `${label} accessible workspace`).not.toBe('none')
    }
    return
  }

  expect(organizations.has(driver.binding.resourceKey), `${label} organization`).toBe(true)
  expect(
    scenario.organizationMemberships.some(
      ({ organizationKey, userKey }) =>
        organizationKey === driver.binding?.resourceKey && userKey === persona?.userKey
    ),
    `${label} organization membership`
  ).toBe(true)
}

function expectSections(
  cases: readonly { pathTemplate: string }[],
  expectedSections: readonly string[]
): void {
  expect(
    cases.map(({ pathTemplate }) => pathTemplate.split('/').at(-1)),
    'literal section coverage'
  ).toEqual(expectedSections)
}

function planeForPath(pathTemplate: string): 'account' | 'organization' | 'workspace' {
  if (pathTemplate.startsWith('/account/')) return 'account'
  if (pathTemplate.startsWith('/organization/')) return 'organization'
  return 'workspace'
}

function expectUnique(values: readonly string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  expect(duplicates, `duplicate ${label}`).toEqual([])
}
