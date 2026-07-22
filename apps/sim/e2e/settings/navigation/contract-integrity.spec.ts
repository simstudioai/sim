import { expect, test } from '@playwright/test'
import { createSettingsPersonaScenarios, SETTINGS_PERSONA_KEYS } from '../personas'
import {
  type AuthenticatedDriver,
  personaVisibilityCases,
  type RouteOutcome,
  routeCases,
  type SectionContract,
  sectionContracts,
} from './contracts'

const scenario = createSettingsPersonaScenarios('navigation-contract').primary
const personas = new Map(scenario.personas.map((persona) => [persona.key, persona]))
const workspaces = new Map(scenario.workspaces.map((workspace) => [workspace.key, workspace]))
const organizations = new Map(
  scenario.organizations.map((organization) => [organization.key, organization])
)

test('navigation contracts have stable independent identities and paths', () => {
  expectUnique(
    sectionContracts.map(({ contractId }) => contractId),
    'section contractId'
  )
  expectUnique(
    sectionContracts.map(({ plane, sectionId }) => `${plane}/${sectionId}`),
    'plane/sectionId'
  )
  expectUnique(
    sectionContracts.map(({ pathTemplate }) => pathTemplate),
    'canonical path'
  )
  expectUnique(
    routeCases.map(({ caseId }) => caseId),
    'route caseId'
  )
  expectUnique(
    routeCases.map(({ pathTemplate }) => pathTemplate),
    'route input path'
  )
  expectUnique(
    personaVisibilityCases.map(({ caseId }) => caseId),
    'visibility caseId'
  )

  const canonicalPaths = new Set(sectionContracts.map(({ pathTemplate }) => pathTemplate))
  for (const routeCase of routeCases) {
    const allowedCanonicalReuse =
      routeCase.outcome.kind === 'organization-unavailable' ||
      routeCase.outcome.kind === 'login-redirect'
    expect(
      canonicalPaths.has(routeCase.pathTemplate) && !allowedCanonicalReuse,
      `${routeCase.caseId} must not duplicate a canonical sidebar path`
    ).toBe(false)
  }

  for (const contract of sectionContracts) {
    const sectionContract: SectionContract = contract
    expect(contract.heading, `${contract.contractId} heading`).not.toBe('')
    expect(contract.description, `${contract.contractId} description`).not.toBe('')
    expect(contract.label, `${contract.contractId} label`).not.toBe('')
    expect(contract.group, `${contract.contractId} group`).not.toBe('')
    expect(contract.readiness, `${contract.contractId} readiness`).toBeTruthy()
    if (sectionContract.successfulResponse) {
      expect(sectionContract.successfulResponse.path, contract.contractId).toMatch(/^\/api\//)
    }
    assertPathBinding(contract.pathTemplate, contract.driver, contract.contractId)
    assertDriverCanReachBinding(contract.driver, contract.contractId)
  }
})

test('route and visibility drivers are coherent with the Step 2 scenario', () => {
  const personaKeys = new Set<string>(SETTINGS_PERSONA_KEYS)
  for (const routeCase of routeCases) {
    const outcome: RouteOutcome = routeCase.outcome
    expect(outcome.kind, `${routeCase.caseId} outcome`).toBeTruthy()
    if (routeCase.driver === 'unauthenticated') {
      expect(outcome.kind, routeCase.caseId).toBe('login-redirect')
      expect(
        routeCase.pathTemplate,
        `${routeCase.caseId} literal unauthenticated path`
      ).not.toMatch(/\{[^}]+\}/)
      continue
    }
    expect(outcome.kind, routeCase.caseId).not.toBe('login-redirect')
    expect(personaKeys.has(routeCase.driver.personaKey), routeCase.caseId).toBe(true)
    assertPathBinding(routeCase.pathTemplate, routeCase.driver, routeCase.caseId)
    if (outcome.kind === 'render') {
      expect(outcome.preserveInputUrl, routeCase.caseId).toBe(true)
      if (outcome.successfulResponse) {
        expect(outcome.successfulResponse.path, routeCase.caseId).toMatch(/^\/api\//)
        expect(outcome.readiness, `${routeCase.caseId} response readiness`).toBeTruthy()
      }
    }
    if (outcome.kind === 'redirect') {
      assertPathBinding(outcome.pathTemplate, routeCase.driver, `${routeCase.caseId} redirect`)
      if (outcome.successfulResponse) {
        expect(outcome.successfulResponse.path, routeCase.caseId).toMatch(/^\/api\//)
      }
      if (!outcome.pathTemplate.includes('/settings')) {
        expect(outcome.readiness, `${routeCase.caseId} destination readiness`).toBeTruthy()
        expect(outcome.successfulResponse, `${routeCase.caseId} destination response`).toBeTruthy()
      }
    }
    if (outcome.kind === 'organization-unavailable') {
      assertUnavailableDriver(routeCase.driver, routeCase.caseId, routeCase.pathTemplate)
    } else {
      assertDriverCanReachBinding(routeCase.driver, routeCase.caseId)
    }
  }

  for (const visibilityCase of personaVisibilityCases) {
    assertDriverCanReachBinding(visibilityCase.driver, visibilityCase.caseId)
    assertPathBinding(
      visibilityCase.plane === 'account'
        ? '/account/settings/{section}'
        : `/${visibilityCase.plane}/{${visibilityCase.plane}Id}/settings/{section}`,
      visibilityCase.driver,
      visibilityCase.caseId
    )
    const visibleSectionIds = new Set<string>(visibilityCase.expectedVisibleSectionIds)
    expect(visibilityCase.expectedVisibleSectionIds, visibilityCase.caseId).toContain(
      visibilityCase.representativeSectionId
    )
    expect(
      visibilityCase.importantHiddenSectionIds.filter((sectionId) =>
        visibleSectionIds.has(sectionId)
      ),
      `${visibilityCase.caseId} visible/hidden overlap`
    ).toEqual([])
    expect(visibilityCase.expectedVisibleLabels, `${visibilityCase.caseId} visible labels`).toEqual(
      visibilityCase.expectedVisibleSectionIds.map((sectionId) =>
        sectionLabel(visibilityCase.plane, sectionId, visibilityCase.caseId)
      )
    )
    expect(visibilityCase.importantHiddenLabels, `${visibilityCase.caseId} hidden labels`).toEqual(
      visibilityCase.importantHiddenSectionIds.map((sectionId) =>
        sectionLabel(visibilityCase.plane, sectionId, visibilityCase.caseId)
      )
    )
  }
})

function assertPathBinding(pathTemplate: string, driver: AuthenticatedDriver, label: string): void {
  const needsOrganization = pathTemplate.includes('{organizationId}')
  const needsWorkspace = pathTemplate.includes('{workspaceId}')
  expect(needsOrganization && needsWorkspace, `${label} dynamic path ambiguity`).toBe(false)
  if (!needsOrganization && !needsWorkspace) {
    expect(driver.binding, `${label} unexpected resource binding`).toBeUndefined()
    return
  }
  expect(driver.binding?.resourceKind, `${label} resource binding kind`).toBe(
    needsOrganization ? 'organization' : 'workspace'
  )
  expect(driver.binding?.worldKey, `${label} world binding`).toBe('settings-primary')
}

function sectionLabel(plane: string, sectionId: string, caseId: string): string {
  const contract = sectionContracts.find(
    (candidate) => candidate.plane === plane && candidate.sectionId === sectionId
  )
  expect(contract, `${caseId} ${plane}/${sectionId} section contract`).toBeTruthy()
  return contract?.label ?? ''
}

function assertDriverCanReachBinding(driver: AuthenticatedDriver, label: string): void {
  const persona = personas.get(driver.personaKey)
  expect(persona, `${label} persona`).toBeTruthy()
  if (!driver.binding) return

  if (driver.binding.resourceKind === 'workspace') {
    expect(workspaces.has(driver.binding.resourceKey), `${label} workspace binding`).toBe(true)
    const expectation = persona?.workspaces.find(
      ({ workspaceKey }) => workspaceKey === driver.binding?.resourceKey
    )
    expect(expectation, `${label} persona workspace expectation`).toBeTruthy()
    expect(expectation?.access, `${label} workspace access`).not.toBe('none')
    return
  }

  expect(organizations.has(driver.binding.resourceKey), `${label} organization binding`).toBe(true)
  const membership = scenario.organizationMemberships.find(
    ({ organizationKey, userKey }) =>
      organizationKey === driver.binding?.resourceKey && userKey === persona?.userKey
  )
  expect(membership, `${label} organization membership`).toBeTruthy()
}

function assertUnavailableDriver(
  driver: AuthenticatedDriver,
  label: string,
  pathTemplate: string
): void {
  const persona = personas.get(driver.personaKey)
  const binding = driver.binding
  expect(persona, `${label} persona`).toBeTruthy()
  expect(binding?.resourceKind, `${label} organization binding`).toBe('organization')
  const membership = scenario.organizationMemberships.find(
    ({ organizationKey, userKey }) =>
      organizationKey === binding?.resourceKey && userKey === persona?.userKey
  )

  if (label === 'organization-non-member-layout-unavailable') {
    expect(membership, `${label} requires non-membership`).toBeUndefined()
    return
  }
  expect(membership, `${label} requires organization membership`).toBeTruthy()
  if (!pathTemplate.endsWith('/unavailable')) {
    expect(membership?.role, `${label} requires insufficient organization role`).toBe('member')
  }
}

function expectUnique(values: readonly string[], label: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  expect(duplicates, `duplicate ${label}`).toEqual([])
}
