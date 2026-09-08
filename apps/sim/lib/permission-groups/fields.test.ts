/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { permissionGroupFullConfigSchema } from '@/lib/api/contracts/permission-groups'
import { PLATFORM_FEATURES } from '@/lib/permission-groups/features'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
  permissionGroupConfigSchema,
} from '@/lib/permission-groups/fields'

/**
 * The coercion corpus, pinned against the hand-written parser before it is
 * replaced by a derived one.
 *
 * Every row states what a stored `jsonb` value coerces to today. A derived
 * implementation has to reproduce this table exactly, so any row that changes
 * in a later diff is a deliberate semantic decision someone has to defend
 * rather than a silent regression.
 */
interface CoercionFixture {
  name: string
  input: unknown
  expected: PermissionGroupConfig
}

const fixtures: readonly CoercionFixture[] = [
  { name: 'null', input: null, expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  { name: 'undefined', input: undefined, expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  /**
   * `typeof [] === 'object'`, so an array-valued column falls through the
   * object guard and coerces to defaults rather than throwing. A derived
   * parser built on `z.object()` throws here unless it guards `Array.isArray`.
   */
  { name: 'an array (jsonb [])', input: [], expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  { name: 'a string', input: 'nope', expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  { name: 'a number', input: 7, expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  { name: 'an empty object', input: {}, expected: DEFAULT_PERMISSION_GROUP_CONFIG },
  {
    name: 'unknown keys, which are dropped',
    input: { bogus: 1, hideCopilot: true },
    expected: { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideCopilot: true },
  },
  {
    name: 'a boolean given a string',
    input: { hideCopilot: 'yes' },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'a boolean given null',
    input: { hideTablesTab: null },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'a boolean given false explicitly',
    input: { hideFilesTab: false },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'a denylist with mixed members, keeping the strings',
    input: { deniedTools: ['slack_canvas', 42, null, { a: 1 }] },
    expected: { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_canvas'] },
  },
  {
    name: 'a denylist given an object',
    input: { deniedModels: {} },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'a denylist given a string',
    input: { deniedModels: 'gpt-4o' },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'auth types with an invalid member, keeping the valid ones',
    input: { allowedFileShareAuthTypes: ['sso', 'bogus', 'password'] },
    expected: {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedFileShareAuthTypes: ['sso', 'password'],
    },
  },
  {
    name: 'auth types given a bare string',
    input: { allowedChatDeployAuthTypes: 'sso' },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'auth types emptied, which denies every mode',
    input: { allowedChatDeployAuthTypes: [] },
    expected: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedChatDeployAuthTypes: [] },
  },
  /**
   * An emptied allowlist denies everything while `null` allows everything, so
   * the two must never collapse into one another.
   */
  {
    name: 'an emptied allowlist, which denies every integration',
    input: { allowedIntegrations: [] },
    expected: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: [] },
  },
  {
    name: 'an explicitly null allowlist',
    input: { allowedModelProviders: null },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  {
    name: 'an allowlist given a string',
    input: { allowedIntegrations: 'slack' },
    expected: DEFAULT_PERMISSION_GROUP_CONFIG,
  },
  /**
   * The allowlists used to be the only keys that skipped element validation, so
   * a `string[]`-typed field could hold a number and the read schema then
   * refused the config it produced. Filtering keeps the members that parse and
   * fails closed.
   */
  {
    name: 'an allowlist with a non-string member, keeping the strings',
    input: { allowedIntegrations: ['slack', 42] },
    expected: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: ['slack'] },
  },
  {
    name: 'a fully populated config',
    input: {
      allowedIntegrations: ['slack_v2'],
      allowedModelProviders: ['anthropic'],
      deniedModels: ['gpt-4o'],
      deniedTools: ['slack_canvas'],
      hideTraceSpans: true,
      hideKnowledgeBaseTab: true,
      hideTablesTab: true,
      hideCopilot: true,
      hideIntegrationsTab: true,
      hideSecretsTab: true,
      hideApiKeysTab: true,
      hideInboxTab: true,
      hideFilesTab: true,
      disableMcpTools: true,
      disableCustomTools: true,
      disableSkills: true,
      disableInvitations: true,
      disablePublicApi: true,
      disablePublicFileSharing: true,
      allowedFileShareAuthTypes: ['sso'],
      hideDeployApi: true,
      hideDeployMcp: true,
      hideDeployChatbot: true,
      allowedChatDeployAuthTypes: ['password'],
      disablePersonalApiKeys: true,
      disableLogExport: true,
      hideCostInfo: true,
      disableKnowledgeBaseCreation: true,
      disableKnowledgeBaseFileUpload: true,
      allowedKnowledgeConnectors: ['google_drive'],
      disableTableCreation: true,
      disableTableExport: true,
      disableBulkFileDownload: true,
      disablePersonalCredentials: true,
      disableWorkspaceCreation: true,
      hideOrgMemberDirectory: true,
      disableCliAccess: true,
      disableWebhookTriggers: true,
      disableToolAutoApproval: true,
      hideSandboxesTab: true,
      disableOAuthAppAccess: true,
    },
    expected: {
      allowedIntegrations: ['slack_v2'],
      allowedModelProviders: ['anthropic'],
      deniedModels: ['gpt-4o'],
      deniedTools: ['slack_canvas'],
      hideTraceSpans: true,
      hideKnowledgeBaseTab: true,
      hideTablesTab: true,
      hideCopilot: true,
      hideIntegrationsTab: true,
      hideSecretsTab: true,
      hideApiKeysTab: true,
      hideInboxTab: true,
      hideFilesTab: true,
      disableMcpTools: true,
      disableCustomTools: true,
      disableSkills: true,
      disableInvitations: true,
      disablePublicApi: true,
      disablePublicFileSharing: true,
      allowedFileShareAuthTypes: ['sso'],
      hideDeployApi: true,
      hideDeployMcp: true,
      hideDeployChatbot: true,
      allowedChatDeployAuthTypes: ['password'],
      disablePersonalApiKeys: true,
      disableLogExport: true,
      hideCostInfo: true,
      disableKnowledgeBaseCreation: true,
      disableKnowledgeBaseFileUpload: true,
      allowedKnowledgeConnectors: ['google_drive'],
      disableTableCreation: true,
      disableTableExport: true,
      disableBulkFileDownload: true,
      disablePersonalCredentials: true,
      disableWorkspaceCreation: true,
      hideOrgMemberDirectory: true,
      disableCliAccess: true,
      disableWebhookTriggers: true,
      disableToolAutoApproval: true,
      hideSandboxesTab: true,
      disableOAuthAppAccess: true,
    },
  },
]

describe('parsePermissionGroupConfig', () => {
  it.each(fixtures)('coerces $name', ({ input, expected }) => {
    expect(parsePermissionGroupConfig(input)).toEqual(expected)
  })

  it.each(fixtures)('emits every key in wire order for $name', ({ input }) => {
    expect(Object.keys(parsePermissionGroupConfig(input))).toEqual(
      Object.keys(DEFAULT_PERMISSION_GROUP_CONFIG)
    )
  })

  it.each(fixtures)('produces a config the read schema accepts for $name', ({ input }) => {
    const parsed = structuredClone(parsePermissionGroupConfig(input))
    expect(permissionGroupFullConfigSchema.safeParse(parsed).success).toBe(true)
  })

  /**
   * The allowlists used to skip element validation, so a corrupted row coerced
   * to a value `permissionGroupFullConfigSchema` then refused — the route
   * reading it failed response validation instead of returning a usable
   * allowlist. Filtering is fail-closed: the members that parse survive, and a
   * corrupt one narrows the allowlist rather than voiding it.
   */
  it('narrows a corrupted allowlist instead of voiding it', () => {
    const parsed = parsePermissionGroupConfig({ allowedIntegrations: ['slack', 42] })
    expect(parsed.allowedIntegrations).toEqual(['slack'])
    expect(permissionGroupFullConfigSchema.safeParse(structuredClone(parsed)).success).toBe(true)
  })

  it('is idempotent', () => {
    for (const { input } of fixtures) {
      const once = parsePermissionGroupConfig(input)
      expect(parsePermissionGroupConfig(structuredClone(once))).toEqual(once)
    }
  })
})

/**
 * A deterministic generator, seeded so a failure reproduces from the printed
 * seed alone. A fixed corpus pins the cases we thought of; this covers the
 * shapes we did not, and asserts only invariants so it stays meaningful after
 * the parser is reimplemented.
 */
function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000
    return state / 0x100000000
  }
}

const MALFORMED_VALUES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  1,
  'sso',
  '',
  [],
  ['slack'],
  ['slack', 42],
  ['sso', 'bogus'],
  [null],
  [{}],
  {},
  { nested: true },
  Number.NaN,
]

describe('parsePermissionGroupConfig invariants', () => {
  const configKeys = Object.keys(DEFAULT_PERMISSION_GROUP_CONFIG)

  it('holds over randomly malformed configs', () => {
    const seed = 0x5eed
    const random = createRandom(seed)

    for (let iteration = 0; iteration < 2000; iteration++) {
      const input: Record<string, unknown> = {}
      for (const key of configKeys) {
        if (random() < 0.35) continue
        input[key] = MALFORMED_VALUES[Math.floor(random() * MALFORMED_VALUES.length)]
      }

      const parsed = parsePermissionGroupConfig(input)
      const context = `seed ${seed}, iteration ${iteration}, input ${JSON.stringify(input)}`

      expect(Object.keys(parsed), context).toEqual(configKeys)
      expect(parsePermissionGroupConfig(structuredClone(parsed)), context).toEqual(parsed)
      expect(
        permissionGroupFullConfigSchema.safeParse(structuredClone(parsed)).success,
        context
      ).toBe(true)
    }
  })
})

describe('permission group config key coverage', () => {
  it('declares the same keys in the write schema, the defaults, and the read schema', () => {
    expect(Object.keys(permissionGroupConfigSchema.shape)).toEqual(
      Object.keys(DEFAULT_PERMISSION_GROUP_CONFIG)
    )
    expect(Object.keys(permissionGroupFullConfigSchema.shape)).toEqual(
      Object.keys(DEFAULT_PERMISSION_GROUP_CONFIG)
    )
  })

  it('registers every boolean config key as a platform feature', () => {
    const booleanKeys = Object.entries(DEFAULT_PERMISSION_GROUP_CONFIG)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key]) => key)

    expect([...PLATFORM_FEATURES.map((feature) => feature.configKey)].sort()).toEqual(
      [...booleanKeys].sort()
    )
  })

  /**
   * Each key gates an act that names no workspace, so each is read from the
   * organization's default group only — a group scoped to specific workspaces
   * cannot deny an account-level login, a workspace that does not exist yet, or
   * a roster read that belongs to the organization rather than to any one
   * workspace. The editor still offers the checkbox on such a group, so the
   * hint is the only place an admin learns where it applies; all three shipped
   * saying nothing, and a hint that omits it is a checkbox that silently
   * enforces nothing wherever an admin is most likely to tick it.
   */
  it.each(['disableWorkspaceCreation', 'disableCliAccess', 'hideOrgMemberDirectory'] as const)(
    "tells an admin that %s is read from the organization's default group",
    (configKey) => {
      const feature = PLATFORM_FEATURES.find((entry) => entry.configKey === configKey)

      expect(feature?.hint).toContain("organization's default group")
    }
  )

  it('gives every platform feature a unique id', () => {
    const ids = PLATFORM_FEATURES.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
