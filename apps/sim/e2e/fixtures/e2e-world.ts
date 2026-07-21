import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type {
  ResolvedScenario,
  ScenarioPersona,
  ScenarioWorkspace,
} from './scenario'

export const PERSONA_MANIFEST_VERSION = 1 as const

const workspaceExpectationSchema = z.object({
  workspaceId: z.string(),
  workspaceKey: z.string(),
  access: z.enum(['none', 'read', 'write', 'admin']),
  roleSource: z.enum(['none', 'owner', 'explicit', 'org-admin']),
  hostContext: z.object({
    isOwner: z.boolean(),
    hostMembership: z.enum(['owner', 'member', 'external']),
    payerScope: z.enum(['user', 'organization']),
    plan: z.enum([
      'free',
      'pro_6000',
      'pro_25000',
      'team_6000',
      'team_25000',
      'enterprise',
    ]),
    hosted: z.boolean(),
    billingEnabled: z.boolean(),
  }),
})

export const personaManifestEntrySchema = z.object({
  key: z.string(),
  world: z.string(),
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  expectedActiveOrganizationId: z.string().nullable(),
  storageStatePath: z.string(),
  canonicalRoute: z.string().startsWith('/'),
  workspaces: z.array(workspaceExpectationSchema).min(1),
  permissionGroupIds: z.array(z.string()),
  expectedPlatformRole: z.enum(['user', 'admin']),
  expectedSuperUserMode: z.boolean(),
})

const worldManifestSchema = z.object({
  namespace: z.object({
    run: z.string(),
    world: z.string(),
    prefix: z.string(),
  }),
  userIds: z.record(z.string(), z.string()),
  userIdentities: z.record(
    z.string(),
    z.object({ id: z.string(), email: z.string().email(), name: z.string() })
  ),
  organizationIds: z.record(z.string(), z.string()),
  organizationIdentities: z.record(
    z.string(),
    z.object({ id: z.string(), name: z.string(), slug: z.string() })
  ),
  organizationMemberIds: z.record(z.string(), z.string()),
  workspaceIds: z.record(z.string(), z.string()),
  workspaceIdentities: z.record(
    z.string(),
    z.object({ id: z.string(), name: z.string() })
  ),
  subscriptionIds: z.record(z.string(), z.string()),
  permissionIds: z.record(z.string(), z.string()),
  permissionGroupIds: z.record(z.string(), z.string()),
  permissionGroupMemberIds: z.record(z.string(), z.string()),
  invitationIds: z.record(z.string(), z.string()),
  invitationGrantIds: z.record(z.string(), z.string()),
})

export const scenarioManifestSchema = z.object({
  schemaVersion: z.literal(PERSONA_MANIFEST_VERSION),
  runId: z.string(),
  createdAt: z.string(),
  authCaptureComplete: z.boolean(),
  worlds: z.record(z.string(), worldManifestSchema),
  personas: z.record(z.string(), personaManifestEntrySchema),
})

export const personaCredentialsSchema = z.object({
  schemaVersion: z.literal(PERSONA_MANIFEST_VERSION),
  runId: z.string(),
  personas: z.record(
    z.string(),
    z.object({
      email: z.string().email(),
      password: z.string().min(12),
    })
  ),
})

export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>
export type PersonaManifestEntry = z.infer<typeof personaManifestEntrySchema>
export type PersonaCredentials = z.infer<typeof personaCredentialsSchema>

export interface CreatedWorldRecords {
  users: Map<string, { id: string; email: string; name: string }>
  organizations: Map<string, { id: string; memberId: string; name: string; slug: string }>
  organizationMembers: Map<string, string>
  workspaces: Map<string, { id: string; name: string }>
  subscriptions: Map<string, string>
  permissions: Map<string, string>
  permissionGroups: Map<string, string>
  permissionGroupMembers: Map<string, string>
  invitations: Map<string, string>
  invitationGrants: Map<string, string>
}

export interface E2EWorld {
  scenario: ResolvedScenario
  records: CreatedWorldRecords
}

export function createWorldRecords(): CreatedWorldRecords {
  return {
    users: new Map(),
    organizations: new Map(),
    organizationMembers: new Map(),
    workspaces: new Map(),
    subscriptions: new Map(),
    permissions: new Map(),
    permissionGroups: new Map(),
    permissionGroupMembers: new Map(),
    invitations: new Map(),
    invitationGrants: new Map(),
  }
}

export function buildScenarioManifest(runId: string, worlds: E2EWorld[]): ScenarioManifest {
  const manifest: ScenarioManifest = {
    schemaVersion: PERSONA_MANIFEST_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    authCaptureComplete: false,
    worlds: {},
    personas: {},
  }

  for (const world of worlds) {
    const worldKey = world.scenario.definition.namespace.world
    manifest.worlds[worldKey] = {
      namespace: world.scenario.definition.namespace,
      userIds: mapValues(world.records.users, ({ id }) => id),
      userIdentities: Object.fromEntries(world.records.users),
      organizationIds: mapValues(world.records.organizations, ({ id }) => id),
      organizationIdentities: Object.fromEntries(
        [...world.records.organizations].map(([key, { id, name, slug }]) => [
          key,
          { id, name, slug },
        ])
      ),
      organizationMemberIds: Object.fromEntries(world.records.organizationMembers),
      workspaceIds: mapValues(world.records.workspaces, ({ id }) => id),
      workspaceIdentities: Object.fromEntries(world.records.workspaces),
      subscriptionIds: Object.fromEntries(world.records.subscriptions),
      permissionIds: Object.fromEntries(world.records.permissions),
      permissionGroupIds: Object.fromEntries(world.records.permissionGroups),
      permissionGroupMemberIds: Object.fromEntries(world.records.permissionGroupMembers),
      invitationIds: Object.fromEntries(world.records.invitations),
      invitationGrantIds: Object.fromEntries(world.records.invitationGrants),
    }
    for (const persona of world.scenario.definition.personas) {
      if (manifest.personas[persona.key]) {
        throw new Error(`Duplicate cross-world persona key: ${persona.key}`)
      }
      manifest.personas[persona.key] = buildPersonaManifest(world, persona)
    }
  }
  assertManifestContainsNoSecrets(manifest)
  return scenarioManifestSchema.parse(manifest)
}

export function readScenarioManifest(filePath: string): ScenarioManifest {
  return scenarioManifestSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')))
}

export function readPersonaCredentials(filePath: string): PersonaCredentials {
  return personaCredentialsSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')))
}

export function writeJsonAtomic(filePath: string, value: unknown, mode = 0o600): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode })
  renameSync(temporaryPath, filePath)
}

export function assertManifestContainsNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const forbidden of [
    'password',
    'cookie',
    'adminApiKey',
    'databaseUrl',
    'invitationToken',
    'stripeSecret',
  ]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(`Non-secret scenario manifest contains forbidden field: ${forbidden}`)
    }
  }
}

function buildPersonaManifest(world: E2EWorld, persona: ScenarioPersona): PersonaManifestEntry {
  const user = required(world.records.users, persona.userKey, 'user')
  const membership = world.scenario.definition.organizationMemberships.find(
    ({ userKey }) => userKey === persona.userKey
  )
  const organizationId = membership
    ? required(world.records.organizations, membership.organizationKey, 'organization').id
    : null
  const canonicalWorkspace = required(
    world.records.workspaces,
    persona.canonicalRoute.workspaceKey,
    'canonical workspace'
  )
  return {
    key: persona.key,
    world: world.scenario.definition.namespace.world,
    userId: user.id,
    email: user.email,
    name: user.name,
    expectedActiveOrganizationId: organizationId,
    storageStatePath: persona.storageStateFilename,
    canonicalRoute: `/workspace/${encodeURIComponent(canonicalWorkspace.id)}/settings/${
      persona.canonicalRoute.settingsSection
    }`,
    workspaces: persona.workspaces.map((expectation) => ({
      workspaceId: required(world.records.workspaces, expectation.workspaceKey, 'workspace').id,
      workspaceKey: expectation.workspaceKey,
      access: expectation.access,
      roleSource: expectation.roleSource,
      hostContext: expectation.hostContext,
    })),
    permissionGroupIds: persona.permissionGroupKeys.map((key) =>
      required(world.records.permissionGroups, key, 'permission group')
    ),
    expectedPlatformRole: persona.expectedPlatformRole,
    expectedSuperUserMode: persona.expectedSuperUserMode,
  }
}

function mapValues<T>(
  values: ReadonlyMap<string, T>,
  select: (value: T) => string
): Record<string, string> {
  return Object.fromEntries([...values].map(([key, value]) => [key, select(value)]))
}

function required<T>(values: ReadonlyMap<string, T>, key: string, label: string): T {
  const value = values.get(key)
  if (!value) throw new Error(`Missing created ${label}: ${key}`)
  return value
}
