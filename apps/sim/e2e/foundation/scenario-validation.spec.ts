import { expect, test } from '@playwright/test'
import { createScenarioNamespace } from '../fixtures/namespace'
import {
  canonicalSettingsRoute,
  type ScenarioDefinition,
  type ScenarioOrganizationMembership,
  type ScenarioPermissionGroup,
  type ScenarioWorkspaceGrant,
} from '../fixtures/scenario'
import { ScenarioValidationError, validateScenario } from '../fixtures/validate-scenario'
import {
  createPrimarySettingsScenario,
  createSettingsPersonaScenarios,
  SETTINGS_PERSONA_KEYS,
} from '../settings/personas'

test.describe('pure scenario validation', () => {
  test('resolves the literal settings cast and minimal isolation twin', () => {
    const scenarios = createSettingsPersonaScenarios('run-42')
    const primary = validateScenario(scenarios.primary)
    const twin = validateScenario(scenarios.isolationTwin)

    expect([...primary.personasByKey.keys()]).toEqual(SETTINGS_PERSONA_KEYS)
    expect(twin.personasByKey.size).toBe(1)
    expect(twin.workspacesByKey.size).toBe(1)
    expect(twin.organizationsByKey.size).toBe(0)

    expect(workspaceExpectation(primary, 'personalPaidOwner').hostContext.plan).toBe('pro_6000')
    expect(workspaceExpectation(primary, 'personalMaxOwner').hostContext.plan).toBe('pro_25000')
    expect(workspaceExpectation(primary, 'workspaceReadMember')).toMatchObject({
      access: 'read',
      roleSource: 'explicit',
      hostContext: { hostMembership: 'member', plan: 'team_6000' },
    })
    expect(workspaceExpectation(primary, 'workspaceWriteMember').access).toBe('write')
    expect(workspaceExpectation(primary, 'workspaceAdminMember')).toMatchObject({
      access: 'admin',
      roleSource: 'explicit',
      hostContext: { hostMembership: 'member' },
    })
    expect(workspaceExpectation(primary, 'externalWorkspaceAdmin')).toMatchObject({
      access: 'admin',
      roleSource: 'explicit',
      hostContext: { hostMembership: 'external' },
    })
    expect(
      primary.definition.organizationMemberships.some(
        ({ userKey }) => userKey === 'external-workspace-admin'
      )
    ).toBe(false)

    expect(workspaceExpectation(primary, 'enterpriseOrganizationAdmin')).toMatchObject({
      access: 'admin',
      roleSource: 'org-admin',
      hostContext: { isOwner: false, plan: 'enterprise' },
    })
    expect(
      primary.definition.workspaceGrants.some(
        ({ userKey }) => userKey === 'enterprise-organization-admin'
      )
    ).toBe(false)
    expect(workspaceExpectation(primary, 'freeOrganizationOwner').hostContext.plan).toBe('free')
    expect(primary.subscriptionsByKey.get('lapsed-team-subscription')?.status).toBe('lapsed')

    const restricted = primary.personasByKey.get('permissionGroupRestricted')
    expect(restricted?.permissionGroups[0]?.restrictions).toEqual({
      hiddenSettings: ['secrets', 'api-keys', 'inbox'],
      disabledFeatures: ['mcp', 'custom-tools'],
    })
    expect(primary.personasByKey.get('platformAdmin')?.user).toMatchObject({
      platformRole: 'admin',
      superUserModeEnabled: true,
    })
    for (const persona of primary.personasByKey.values()) {
      expect(persona.workspaces.some(({ expectation }) => expectation.access !== 'none')).toBe(true)
      expect(persona.definition.canonicalRoute.settingsSection).toBe('general')
    }
    expect(workspaceExpectation(primary, 'personalFreeOwner', 'team-workspace')).toMatchObject({
      access: 'none',
      roleSource: 'none',
    })
  })

  test('namespaces controllable values deterministically without manufacturing API IDs', () => {
    const first = createScenarioNamespace('Run 42/Alpha', 'Primary World')
    const again = createScenarioNamespace('Run 42/Alpha', 'Primary World')
    const otherWorld = createScenarioNamespace('Run 42/Alpha', 'Twin World')

    expect(first).toMatchObject({
      run: 'Run 42/Alpha',
      world: 'Primary World',
    })
    expect(first.email('Owner')).toBe(again.email('Owner'))
    expect(first.slug('Organization')).toBe(again.slug('Organization'))
    expect(first.name('Workspace')).toBe(again.name('Workspace'))
    expect(first.invitationToken('Invite')).toBe(again.invitationToken('Invite'))
    expect(first.storageStateFilename('personalFreeOwner')).toBe(
      again.storageStateFilename('personalFreeOwner')
    )
    expect(first.email('Owner')).not.toBe(otherWorld.email('Owner'))
    expect(first.storageStateFilename('personalFreeOwner')).toMatch(/\.json$/)
    expect(Object.keys(first).some((key) => /(^|api)id$/i.test(key))).toBe(false)
    expect(canonicalSettingsRoute('opaque/id:generated-by-api', 'api-keys')).toBe(
      '/workspace/opaque%2Fid%3Agenerated-by-api/settings/api-keys'
    )
  })

  test('rejects duplicate organization memberships', () => {
    const scenario = validScenario()
    scenario.organizationMemberships = [
      ...scenario.organizationMemberships,
      scenario.organizationMemberships[0],
    ] as ScenarioOrganizationMembership[]
    expectInvalid(scenario, /duplicate organization membership/)
  })

  test('rejects incoherent organization workspace payer and subscription identity', () => {
    const scenario = validScenario()
    scenario.workspaces = scenario.workspaces.map((workspace) =>
      workspace.key === 'team-workspace'
        ? {
            ...workspace,
            payer: { kind: 'organization', organizationKey: 'enterprise-organization' },
          }
        : workspace
    )
    expectInvalid(scenario, /incoherent payer/)
  })

  test('rejects owner or organization-admin expectations below admin', () => {
    const scenario = validScenario()
    scenario.personas = scenario.personas.map((persona) =>
      persona.key === 'enterpriseOrganizationAdmin'
        ? {
            ...persona,
            workspaces: persona.workspaces.map((expectation) => ({
              ...expectation,
              access: 'read',
            })),
          }
        : persona
    )
    expectInvalid(scenario, /below admin/)
  })

  test('rejects invalid and misplaced Enterprise metadata', () => {
    const invalidEnterprise = validScenario()
    invalidEnterprise.subscriptions = invalidEnterprise.subscriptions.map((subscription) =>
      subscription.key === 'enterprise-subscription'
        ? { ...subscription, enterprise: { ...subscription.enterprise!, monthlyPrice: 0 } }
        : subscription
    )
    expectInvalid(invalidEnterprise, /invalid Enterprise metadata/)

    const metadataOnTeam = validScenario()
    metadataOnTeam.subscriptions = metadataOnTeam.subscriptions.map((subscription) =>
      subscription.key === 'team-subscription'
        ? {
            ...subscription,
            enterprise: {
              plan: 'enterprise',
              referenceId: 'wrong-plan',
              monthlyPrice: 1,
              seats: 4,
            },
          }
        : subscription
    )
    expectInvalid(metadataOnTeam, /non-Enterprise subscription/)
  })

  test('rejects permission groups without active Enterprise organization/workspace scope', () => {
    const scenario = validScenario()
    scenario.permissionGroups = scenario.permissionGroups.map((group) => ({
      ...group,
      organizationKey: 'team-organization',
      workspaceKeys: ['team-workspace'],
    }))
    expectInvalid(scenario, /requires an active Enterprise organization/)
  })

  test('rejects duplicate explicit grants and default groups', () => {
    const duplicateGrant = validScenario()
    duplicateGrant.workspaceGrants = [
      ...duplicateGrant.workspaceGrants,
      duplicateGrant.workspaceGrants[0],
    ] as ScenarioWorkspaceGrant[]
    expectInvalid(duplicateGrant, /duplicate workspace grant/)

    const duplicateDefault = validScenario()
    const existing = duplicateDefault.permissionGroups[0]
    duplicateDefault.permissionGroups = [
      { ...existing, isDefault: true },
      {
        ...existing,
        key: 'second-default-enterprise-group',
        name: `${existing.name} Second`,
        isDefault: true,
      },
    ] as ScenarioPermissionGroup[]
    expectInvalid(duplicateDefault, /duplicate default groups/)
  })

  test('rejects inconsistent hosted and billing flags', () => {
    const hosted = validScenario()
    hosted.workspaces = hosted.workspaces.map((workspace, index) =>
      index === 0 ? { ...workspace, hosted: false } : workspace
    )
    expectInvalid(hosted, /inconsistent hosted flag/)

    const billing = validScenario()
    billing.users = billing.users.map((user, index) =>
      index === 0 ? { ...user, billingEnabled: false } : user
    )
    expectInvalid(billing, /inconsistent billing flag/)
  })

  test('rejects zero-workspace personas and none-only foreign denial declarations', () => {
    const empty = validScenario()
    empty.personas = empty.personas.map((persona) =>
      persona.key === 'personalPaidOwner' ? { ...persona, workspaces: [] } : persona
    )
    expectInvalid(empty, /zero accessible seeded workspaces/)

    const noneOnly = validScenario()
    noneOnly.personas = noneOnly.personas.map((persona) =>
      persona.key === 'personalFreeOwner'
        ? {
            ...persona,
            workspaces: persona.workspaces.filter(({ access }) => access === 'none'),
            canonicalRoute: { workspaceKey: 'team-workspace', settingsSection: 'general' },
          }
        : persona
    )
    expectInvalid(noneOnly, /zero accessible seeded workspaces/)
  })

  test('rejects invalid references and duplicate controllable identities', () => {
    const badReference = validScenario()
    badReference.workspaceGrants = badReference.workspaceGrants.map((grant, index) =>
      index === 0 ? { ...grant, userKey: 'missing-user' } : grant
    )
    expectInvalid(badReference, /references missing user/)

    const duplicateEmail = validScenario()
    duplicateEmail.users = duplicateEmail.users.map((user, index, users) =>
      index === 1 ? { ...user, email: users[0].email.toUpperCase() } : user
    )
    expectInvalid(duplicateEmail, /duplicate email/)

    const duplicateStorageState = validScenario()
    duplicateStorageState.personas = duplicateStorageState.personas.map(
      (persona, index, personas) =>
        index === 1
          ? { ...persona, storageStateFilename: personas[0].storageStateFilename }
          : persona
    )
    expectInvalid(duplicateStorageState, /duplicate storage-state filename/)
  })
})

function validScenario(): MutableScenario {
  return structuredClone(
    createPrimarySettingsScenario(createScenarioNamespace('validation-run', 'primary'))
  ) as MutableScenario
}

type MutableScenario = {
  -readonly [Key in keyof ScenarioDefinition]: ScenarioDefinition[Key] extends readonly (infer Item)[]
    ? Item[]
    : ScenarioDefinition[Key]
}

function expectInvalid(scenario: ScenarioDefinition, message: RegExp): void {
  expect(() => validateScenario(scenario)).toThrow(ScenarioValidationError)
  expect(() => validateScenario(scenario)).toThrow(message)
}

function workspaceExpectation(
  scenario: ReturnType<typeof validateScenario>,
  personaKey: string,
  workspaceKey?: string
) {
  const persona = scenario.personasByKey.get(personaKey)
  if (!persona) throw new Error(`Missing persona "${personaKey}"`)
  const expectation = workspaceKey
    ? persona.definition.workspaces.find((candidate) => candidate.workspaceKey === workspaceKey)
    : persona.definition.workspaces.find((candidate) => candidate.access !== 'none')
  if (!expectation) throw new Error(`Missing workspace expectation for "${personaKey}"`)
  return expectation
}
