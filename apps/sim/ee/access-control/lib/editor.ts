import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import {
  type PermissionGroupPlatformFeature,
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  createModelGate,
  type ModelFacts,
  resolveAgentDefault,
} from '@/lib/permission-groups/model-gate'
import { withPermissionGroupAccessState } from '@/ee/access-control/utils/access-state'
import {
  type AccessRequestCatalog,
  type AccessRequestTarget,
  createAccessRequestCatalog,
  describeAccessRequestTarget,
  getAccessRequestTargetParents,
  getPermissionGroupAccessState,
  type PermissionGroupAccessState,
  validateAccessRequestTarget,
} from '@/ee/access-requests/lib/targets'
import { SIM_AUTO_MODEL_ID } from '@/providers/model-lookup'

const BLOCK_CATEGORY_ORDER: Record<string, number> = { triggers: 0, blocks: 1, tools: 2 }

/** The order the editor lists its allowlist universe in: by category, then by name. */
export function compareEditorBlocks(
  a: { category: string; name: string },
  b: { category: string; name: string }
): number {
  const catA = BLOCK_CATEGORY_ORDER[a.category] ?? 3
  const catB = BLOCK_CATEGORY_ORDER[b.category] ?? 3
  if (catA !== catB) return catA - catB
  return a.name.localeCompare(b.name)
}

/** Public-file-share auth modes an admin can allow/disallow. `null` config = all allowed. */
export const FILE_SHARE_AUTH_TYPE_OPTIONS: { value: ShareAuthType; label: string }[] = [
  { value: 'public', label: 'Anyone with link' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email' },
  { value: 'sso', label: 'SSO' },
]

/** Chat-deployment auth modes an admin can allow/disallow. `null` config = all allowed. */
export const CHAT_DEPLOY_AUTH_TYPE_OPTIONS: { value: ShareAuthType; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email' },
  { value: 'sso', label: 'SSO' },
]

export type PermissionStatusFilter = 'all' | 'enabled' | 'disabled' | 'requestable' | 'unavailable'

const STATUS_FILTER_OPTIONS: { value: PermissionStatusFilter; label: string }[] = [
  { value: 'all', label: 'Show all' },
  { value: 'enabled', label: 'Allowed' },
  { value: 'requestable', label: 'Can request' },
  { value: 'unavailable', label: 'Unavailable' },
]

/** `disabled` is reachable only from an old link, so it is offered only while selected. */
export function statusFilterOptions(
  value: PermissionStatusFilter
): { value: PermissionStatusFilter; label: string }[] {
  return value === 'disabled'
    ? [...STATUS_FILTER_OPTIONS, { value: 'disabled', label: 'Restricted' }]
    : STATUS_FILTER_OPTIONS
}

export function matchesStatusFilter(
  filter: PermissionStatusFilter,
  state: PermissionGroupAccessState
): boolean {
  return (
    filter === 'all' ||
    (filter === 'enabled'
      ? state === 'allowed'
      : filter === 'disabled'
        ? state !== 'allowed'
        : state === filter)
  )
}

const ACCESS_OPTIONS = [
  { value: 'allowed', label: 'Allowed' },
  { value: 'requestable', label: 'Can request' },
  { value: 'unavailable', label: 'Unavailable' },
] as const

export function accessStateLabel(state: PermissionGroupAccessState): string | undefined {
  return ACCESS_OPTIONS.find((option) => option.value === state)?.label
}

/** A row's choices, retaining an unsupported inherited value while the row is disabled. */
export function accessStateOptions(
  canRequest: boolean,
  value: PermissionGroupAccessState,
  disabled: boolean | undefined
) {
  return canRequest
    ? ACCESS_OPTIONS
    : ACCESS_OPTIONS.filter(
        (option) => option.value !== 'requestable' || (disabled && value === 'requestable')
      )
}

/** A bulk action's choices; the caller decides whether every target supports requests. */
export function bulkAccessOptions(canRequest: boolean) {
  return canRequest
    ? ACCESS_OPTIONS
    : ACCESS_OPTIONS.filter((option) => option.value !== 'requestable')
}

/** The block fields the editor's request catalog reads. */
export interface EditorCatalogBlock {
  type: string
  name: string
  toolIds: readonly string[]
}

/** Tools belonging to exactly one built-in block; a shared tool has no single parent to request. */
function collectPublicTools(blocks: readonly EditorCatalogBlock[]) {
  const parentByTool = new Map<string, string | null>()
  for (const block of blocks) {
    if (block.type.startsWith('custom_block_')) continue
    for (const id of block.toolIds) {
      if (!parentByTool.has(id)) parentByTool.set(id, block.type)
      else if (parentByTool.get(id) !== block.type) parentByTool.set(id, null)
    }
  }
  return [...parentByTool].flatMap(([id, parent]) =>
    parent ? [{ id, label: id, integrationId: parent }] : []
  )
}

/**
 * The catalog the editor resolves access against. `blocks` must be the allowlist UNIVERSE, not the
 * rendered list: materialization and the collapse-to-null comparison read it, and a viewer-filtered
 * set would silently drop a preview block from the stored allowlist on a null-to-partial transition.
 */
export function createEditorCatalog(input: {
  blocks: readonly EditorCatalogBlock[]
  providers: ReadonlyArray<{ id: string; label: string; modelIds: readonly string[] }>
  knowledgeConnectors: ReadonlyArray<{ value: string; label: string }>
}): AccessRequestCatalog {
  return createAccessRequestCatalog({
    integrations: input.blocks.map((block) => ({ id: block.type, label: block.name })),
    providers: input.providers.map(({ id, label }) => ({ id, label })),
    models: input.providers.flatMap(({ id: providerId, modelIds }) =>
      modelIds.map((id) => ({ id, label: id, providerId }))
    ),
    tools: collectPublicTools(input.blocks),
    knowledgeConnectors: input.knowledgeConnectors.map(({ value, label }) => ({
      id: value,
      label,
    })),
  })
}

/** Resolves draft policy and inheritance, and checks request support. */
export interface PermissionResolvers {
  getState: (target: AccessRequestTarget) => PermissionGroupAccessState
  isInherited: (target: AccessRequestTarget) => boolean
  getInheritedFrom: (target: AccessRequestTarget) => string | null
  canRequest: (target: AccessRequestTarget) => boolean
}

function canRequestTarget(target: AccessRequestTarget, catalog: AccessRequestCatalog): boolean {
  if (target.kind === 'integration' && target.id.startsWith('custom_block_')) return false
  return validateAccessRequestTarget(target, catalog) !== null
}

export function createPermissionResolvers(
  config: PermissionGroupConfig,
  catalog: AccessRequestCatalog
): PermissionResolvers {
  const canRequest = (target: AccessRequestTarget) => canRequestTarget(target, catalog)
  const getState = (target: AccessRequestTarget) => {
    const state = getPermissionGroupAccessState(target, config, catalog)
    return state === 'requestable' && !canRequest(target) ? 'unavailable' : state
  }
  const getInheritedFrom = (target: AccessRequestTarget): string | null => {
    const parent = getAccessRequestTargetParents(target, catalog).find(
      (parent) => getState(parent) !== 'allowed'
    )
    if (!parent) return null
    return (
      getInheritedFrom(parent) ??
      describeAccessRequestTarget(parent, catalog)?.label ??
      'a restricted parent'
    )
  }
  return {
    getState,
    canRequest,
    getInheritedFrom,
    isInherited: (target) => getInheritedFrom(target) !== null,
  }
}

/** The config after an edit: a target under a restricted parent, or that cannot be requested, stays. */
export function applyPermissionAccess(
  previous: PermissionGroupConfig,
  targets: readonly AccessRequestTarget[],
  state: PermissionGroupAccessState,
  catalog: AccessRequestCatalog
): PermissionGroupConfig {
  const editable = targets.filter(
    (target) =>
      (state !== 'requestable' || canRequestTarget(target, catalog)) &&
      !getAccessRequestTargetParents(target, catalog).some(
        (parent) => getPermissionGroupAccessState(parent, previous, catalog) !== 'allowed'
      )
  )
  return editable.reduce(
    (config, target) => withPermissionGroupAccessState(config, target, state, catalog),
    previous
  )
}

/** A child row's view of its parent: the parent's restriction wins, and names itself as the reason. */
export function inheritedPermissionResolvers<Controls extends PermissionResolvers>(
  parent: AccessRequestTarget,
  parentLabel: string,
  controls: Controls
): Controls {
  const parentState = controls.getState(parent)
  return {
    ...controls,
    getState: (target) => {
      const state = controls.getState(target)
      return parentState === 'unavailable' || state === 'unavailable'
        ? 'unavailable'
        : parentState === 'requestable'
          ? 'requestable'
          : state
    },
    isInherited: (target) => parentState !== 'allowed' || controls.isInherited(target),
    getInheritedFrom: (target) =>
      parentState !== 'allowed'
        ? (controls.getInheritedFrom(parent) ?? parentLabel)
        : controls.getInheritedFrom(target),
  }
}

/** Set-based, so reordering a list is not an edit. */
export function hasPermissionConfigChanges(
  saved: PermissionGroupConfig,
  edited: PermissionGroupConfig
): boolean {
  return (Object.keys(edited) as (keyof PermissionGroupConfig)[]).some((key) => {
    const savedValue = saved[key]
    const editedValue = edited[key]
    if (!Array.isArray(savedValue) || !Array.isArray(editedValue)) return savedValue !== editedValue
    const savedMembers = new Set<string>(savedValue)
    const editedMembers = new Set<string>(editedValue)
    return (
      savedMembers.size !== editedMembers.size ||
      [...savedMembers].some((member) => !editedMembers.has(member))
    )
  })
}

export function searchPlatformFeatures(search: string): readonly PermissionGroupPlatformFeature[] {
  const query = search.trim().toLowerCase()
  if (!query) return PLATFORM_FEATURES
  return PLATFORM_FEATURES.filter(
    (f) => f.label.toLowerCase().includes(query) || f.category.toLowerCase().includes(query)
  )
}

/** Known categories in product order, then anything newer. */
export function platformFeatureSections(features: readonly PermissionGroupPlatformFeature[]) {
  const categories: Record<string, PermissionGroupPlatformFeature[]> = {}
  for (const feature of features) {
    if (!categories[feature.category]) categories[feature.category] = []
    categories[feature.category].push(feature)
  }
  const known = PLATFORM_CATEGORY_ORDER.filter((c) => categories[c]?.length)
  const extras = Object.keys(categories).filter(
    (c) => !PLATFORM_CATEGORY_ORDER.includes(c) && categories[c]?.length
  )
  return [...known, ...extras].map((category) => ({
    category,
    features: categories[category] ?? [],
  }))
}

/** Which of the group's sub-permission grids a feature row carries. */
export const FEATURE_PERMISSION_GRIDS = {
  'hide-deploy-chatbot': 'chat_deploy_auth',
  'disable-public-file-sharing': 'file_share_auth',
  'hide-knowledge-base': 'knowledge_connector',
} as const

/** Sentinel for "no default chosen" in the Agent default picker. */
export const PLATFORM_DEFAULT_MODEL = '__platform-default__'

function agentDefaultModelId(provider: string, model: string): string {
  return provider === 'ollama' && !model.toLowerCase().startsWith('ollama/')
    ? `ollama/${model}`
    : model
}

/** The default-model choices a group may offer: allowed by its own policy and not deprecated. */
export function agentDefaultModelIds(input: {
  config: PermissionGroupConfig
  providerIds: readonly string[]
  staticModels: (provider: string) => readonly string[]
  dynamicModels: ReadonlyArray<{ provider: string; models: readonly string[] }>
  hosted: boolean
  facts: ModelFacts
}): { autoAllowed: boolean; models: string[] } {
  const { config, providerIds, staticModels, dynamicModels, hosted, facts } = input
  const isAllowed = createModelGate(config, facts.findProvider)
  const models = new Set([
    ...providerIds.flatMap((provider) =>
      staticModels(provider).map((model) => agentDefaultModelId(provider, model))
    ),
    ...dynamicModels.flatMap(({ provider, models }) =>
      models.map((model) => agentDefaultModelId(provider, model))
    ),
  ])
  return {
    autoAllowed: hosted && isAllowed(SIM_AUTO_MODEL_ID),
    models: [...models].filter(
      (model) => isAllowed(model) && facts.sunsetStatus(model) !== 'deprecated'
    ),
  }
}

/** A saved default the current policy no longer permits blocks saving until it is changed. */
export function isAgentDefaultUsable(
  config: PermissionGroupConfig,
  options: { hosted: boolean; providerIds: readonly string[] },
  facts: ModelFacts
): boolean {
  return (
    !config.defaultAgentModel ||
    Boolean(
      resolveAgentDefault(
        config,
        { allowAuto: options.hosted, availableProviderIds: options.providerIds },
        facts
      )
    )
  )
}
