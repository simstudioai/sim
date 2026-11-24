import { compareStrings, stripVersionSuffix } from '@sim/utils/string'
import { isTriggerSurface } from '@sim/workflow-code/catalog/surface'
import {
  SDK_CORE_BLOCK_BUILDERS,
  SDK_CORE_EXPORTS,
  SDK_RESERVED_IDENTIFIERS,
} from '@sim/workflow-code/sdk'
import type { BlockConfig } from '@/blocks/types'

/**
 * The frozen SDK names (`apps/sim/blocks/sdk-names/<type>.json`, one file per block type).
 *
 * A builder's method name is API: once a workflow file says `slack.sendMessage(...)`, renaming the
 * option label must not break it. So names are derived once, written to a checked-in file, and
 * afterwards only ever added to. The stored operation id is never renamed by any of this.
 */
interface SdkNamesBlockEntry {
  /** Dotted builder namespace (`slack`, `legacy.slackV1`, `trigger.webhook`). */
  namespace: string
  /** Operation dropdown id → method name, for blocks with an `operation` dropdown. */
  methods?: Record<string, string>
  /** Trigger id → method name under `trigger.<namespace>`. */
  triggers?: Record<string, string>
  /** Param renames per surface (`oauthCredential` / `triggerCredentials` → `credential`). */
  paramAliases?: Partial<Record<SdkSurface, Record<string, string>>>
}

/** The frozen SDK names (`blocks/sdk-names/`): each block type's namespace and method names. */
export interface SdkNamesFile {
  version: 1
  blocks: Record<string, SdkNamesBlockEntry>
}

type SdkSurface = 'action' | 'trigger'

/** One parameter as the SDK sees it: a pair is one param named by its `canonicalParamId`. */
interface SdkParamSource {
  name: string
  /** `pair:<canonicalParamId>` or `id:<subBlockId>`; two identities may not share a name. */
  identity: string
}

/** The registry facts name derivation reads, so it stays a pure function of data. */
export interface SdkNameSource {
  type: string
  /** Hidden from the toolbar: a superseded version or a sunset block. */
  hidden: boolean
  /**
   * A trigger block (registry `category: 'triggers'`): its builder is itself a trigger, named under
   * `trigger.` (`trigger.start`, `trigger.webhook`), with no per-trigger methods.
   */
  triggerBlock: boolean
  operations: Array<{ id: string; label: string }>
  triggers: Array<{ id: string; provider: string }>
  params: Record<SdkSurface, SdkParamSource[]>
}

/** Param names aliased to `credential` when the surface has no `credential` of its own. */
const CREDENTIAL_ALIAS_SOURCES = new Set(['oauthCredential', 'triggerCredentials'])
const CREDENTIAL_ALIAS = 'credential'

const CORE_EXPORTS: ReadonlySet<string> = new Set(SDK_CORE_EXPORTS)

/** Namespace roots a block may never take; `custom` is the per-org custom block tree. */
const SDK_OWNED_ROOTS = new Set<string>([
  'custom',
  ...SDK_CORE_EXPORTS.filter((name) => !SDK_CORE_BLOCK_BUILDERS.has(name)),
])

/**
 * Default namespaces that are not the camelCased type, matching the builder names `core.d.ts`
 * documents for the core blocks.
 */
const NAMESPACE_SEEDS: Record<string, string> = {
  function: 'fn',
  workflow_input: 'runWorkflow',
  human_in_the_loop_v2: 'human',
  variables: 'setVariables',
  generic_webhook: 'webhook',
  mothership: 'simChat',
}

/** The root a visible trigger block's namespace sits under. */
const TRIGGER_ROOT = 'trigger'
const TRIGGER_TYPE_SUFFIX = /_trigger$/

/** Members a generated namespace declares besides its methods (`const tool`). */
const NAMESPACE_MEMBERS = new Set<string>(['tool'])

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** `'Send Message'` → `sendMessage`; `'list_dns_records'` → `listDnsRecords`. */
export function toCamelIdentifier(text: string): string {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/**
 * A method or trigger name: an identifier that is not a JS reserved word (a generated
 * `namespace { function delete() }` does not parse). Core SDK exports are fine here: a method is a
 * member, so `helpscout.runWorkflow` never shadows the core `runWorkflow`.
 */
function isUsableIdentifier(name: string): boolean {
  return IDENTIFIER.test(name) && (!SDK_RESERVED_IDENTIFIERS.has(name) || CORE_EXPORTS.has(name))
}

/** First of `candidates` that is a usable identifier, else the first with a `_` suffix. */
function firstUsable(candidates: string[]): string | undefined {
  for (const candidate of candidates) if (isUsableIdentifier(candidate)) return candidate
  for (const candidate of candidates) {
    if (IDENTIFIER.test(candidate)) return `${candidate}_`
  }
  return undefined
}

/** `base`, else `base2`, `base3`, … — the first not in `taken`. */
function suffixUntilFree(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function pickFree(candidates: string[], taken: ReadonlySet<string>, fallback: string): string {
  const usable = candidates.filter((candidate) => isUsableIdentifier(candidate))
  for (const candidate of usable) if (!taken.has(candidate)) return candidate
  return suffixUntilFree(usable[0] ?? firstUsable(candidates) ?? fallback, taken)
}

/**
 * A visible block takes its seed, else its unversioned camelCased type, else the full type; a
 * visible trigger block takes the same under `trigger.`, with a `_trigger` suffix dropped; a
 * toolbar-hidden one (superseded or sunset) lives under `legacy.` by its full type. The first free
 * usable candidate wins, else the first candidate with a numeric suffix.
 */
function defaultNamespace(source: SdkNameSource, taken: ReadonlySet<string>): string {
  const full = toCamelIdentifier(source.type)
  const underTrigger = source.triggerBlock && !source.hidden
  const prefix = source.hidden ? 'legacy.' : underTrigger ? `${TRIGGER_ROOT}.` : ''
  const unversioned = stripVersionSuffix(source.type)
  const candidates = (
    source.hidden
      ? [full]
      : [
          NAMESPACE_SEEDS[source.type],
          toCamelIdentifier(
            underTrigger ? unversioned.replace(TRIGGER_TYPE_SUFFIX, '') : unversioned
          ),
          full,
        ]
  ).filter(
    (candidate): candidate is string =>
      candidate !== undefined &&
      isUsableIdentifier(candidate) &&
      (source.hidden || underTrigger || !SDK_OWNED_ROOTS.has(candidate))
  )
  const base = candidates[0] ?? `${full.replace(/^(?=\d)/, '_')}Block`
  for (const candidate of [...candidates, base]) {
    if (!taken.has(`${prefix}${candidate}`)) return `${prefix}${candidate}`
  }
  let n = 2
  while (taken.has(`${prefix}${base}${n}`)) n++
  return `${prefix}${base}${n}`
}

function triggerMethodCandidates(blockType: string, trigger: { id: string; provider: string }) {
  const id = stripVersionSuffix(trigger.id)
  const prefixes = [`${stripVersionSuffix(blockType)}_`, `${trigger.provider}_`]
  const stripped = prefixes.reduce(
    (current, prefix) => (current.startsWith(prefix) ? current.slice(prefix.length) : current),
    id
  )
  return [toCamelIdentifier(stripped), toCamelIdentifier(trigger.id)]
}

/**
 * Returns `existing` plus entries for every block, operation, trigger and alias it lacks.
 * Existing names are never changed, so a later label edit cannot rename a method. Sources are
 * processed in type order, visible blocks first, so a new block's namespace is deterministic.
 */
export function extendSdkNames(
  existing: SdkNamesFile,
  sources: readonly SdkNameSource[]
): { names: SdkNamesFile; added: string[] } {
  const blocks: Record<string, SdkNamesBlockEntry> = structuredClone(existing.blocks)
  const added: string[] = []
  const takenNamespaces = new Set(Object.values(blocks).map((entry) => entry.namespace))

  const ordered = [...sources].sort((a, b) =>
    a.hidden === b.hidden ? compareStrings(a.type, b.type) : a.hidden ? 1 : -1
  )

  for (const source of ordered) {
    let entry = blocks[source.type]
    if (!entry) {
      const namespace = defaultNamespace(source, takenNamespaces)
      takenNamespaces.add(namespace)
      entry = { namespace }
      blocks[source.type] = entry
      added.push(`${source.type}: namespace ${namespace}`)
    }

    if (source.operations.length > 0) {
      const methods = entry.methods ?? {}
      const taken = new Set([...NAMESPACE_MEMBERS, ...Object.values(methods)])
      for (const operation of source.operations) {
        if (Object.hasOwn(methods, operation.id)) continue
        const method = pickFree(
          [toCamelIdentifier(operation.label), toCamelIdentifier(operation.id)],
          taken,
          'operation'
        )
        methods[operation.id] = method
        taken.add(method)
        added.push(`${source.type}: method ${operation.id} → ${method}`)
      }
      entry.methods = methods
    }

    if (source.triggers.length > 0) {
      const triggers = entry.triggers ?? {}
      const taken = new Set(Object.values(triggers))
      for (const trigger of source.triggers) {
        if (Object.hasOwn(triggers, trigger.id)) continue
        const method = pickFree(triggerMethodCandidates(source.type, trigger), taken, 'trigger')
        triggers[trigger.id] = method
        taken.add(method)
        added.push(`${source.type}: trigger ${trigger.id} → ${method}`)
      }
      entry.triggers = triggers
    }

    for (const surface of ['action', 'trigger'] as const) {
      const aliases = entry.paramAliases?.[surface] ?? {}
      const names = new Set(source.params[surface].map((param) => param.name))
      const used = new Set([...names, ...Object.values(aliases)])
      for (const name of [...names].sort(compareStrings)) {
        if (Object.hasOwn(aliases, name) || !CREDENTIAL_ALIAS_SOURCES.has(name)) continue
        if (used.has(CREDENTIAL_ALIAS)) continue
        aliases[name] = CREDENTIAL_ALIAS
        used.add(CREDENTIAL_ALIAS)
        added.push(`${source.type}: ${surface} param ${name} → ${CREDENTIAL_ALIAS}`)
      }
      if (Object.keys(aliases).length > 0)
        entry.paramAliases = { ...entry.paramAliases, [surface]: aliases }
    }
  }

  return { names: { version: 1, blocks: sortEntries(blocks) }, added }
}

/** A key-sorted copy, so serialized output does not depend on insertion order. */
export function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => compareStrings(a, b))
  ) as Record<string, T>
}

/** Key-sorted copy so the file diffs one line per added name. */
function sortEntries(
  blocks: Record<string, SdkNamesBlockEntry>
): Record<string, SdkNamesBlockEntry> {
  const sorted: Record<string, SdkNamesBlockEntry> = {}
  for (const [type, entry] of Object.entries(sortRecord(blocks))) {
    const next: SdkNamesBlockEntry = { namespace: entry.namespace }
    if (entry.methods) next.methods = sortRecord(entry.methods)
    if (entry.triggers) next.triggers = sortRecord(entry.triggers)
    if (entry.paramAliases) {
      const paramAliases: Partial<Record<SdkSurface, Record<string, string>>> = {}
      if (entry.paramAliases.action) paramAliases.action = sortRecord(entry.paramAliases.action)
      if (entry.paramAliases.trigger) paramAliases.trigger = sortRecord(entry.paramAliases.trigger)
      next.paramAliases = paramAliases
    }
    sorted[type] = next
  }
  return sorted
}

function namespaceIsValid(namespace: string): boolean {
  const segments = namespace.split('.')
  if (segments.some((segment) => !isUsableIdentifier(segment))) return false
  if (segments.length === 1) return !SDK_OWNED_ROOTS.has(namespace)
  return segments.length === 2 && (segments[0] === 'legacy' || segments[0] === TRIGGER_ROOT)
}

/**
 * Every problem with `names` against the registry: anything the generator would add (a namespace,
 * method, trigger method or credential alias: it was not run), an invalid identifier, or two
 * things sharing one name. Sorted, so the check output is stable.
 */
export function validateSdkNames(names: SdkNamesFile, sources: readonly SdkNameSource[]): string[] {
  const issues: string[] = []
  const namespaceOwners = new Map<string, string>()
  for (const [type, entry] of Object.entries(names.blocks)) {
    if (!namespaceIsValid(entry.namespace)) {
      issues.push(`${type}: namespace "${entry.namespace}" is not a valid SDK namespace`)
    }
    const owner = namespaceOwners.get(entry.namespace)
    if (owner) issues.push(`${type}: namespace "${entry.namespace}" collides with ${owner}`)
    else namespaceOwners.set(entry.namespace, type)

    for (const [kind, record] of [
      ['method', entry.methods],
      ['trigger', entry.triggers],
    ] as const) {
      const seen = new Map<string, string>()
      for (const [id, name] of Object.entries(record ?? {})) {
        if (!isUsableIdentifier(name) || (kind === 'method' && NAMESPACE_MEMBERS.has(name))) {
          issues.push(`${type}: ${kind} "${name}" (${id}) is not a usable identifier`)
        }
        const other = seen.get(name)
        if (other) issues.push(`${type}: ${kind} "${name}" names both ${other} and ${id}`)
        else seen.set(name, id)
      }
    }
  }

  const triggerMethodRoots = new Map<string, string>()
  for (const [type, entry] of Object.entries(names.blocks)) {
    if (entry.triggers && Object.keys(entry.triggers).length > 0) {
      triggerMethodRoots.set(`${TRIGGER_ROOT}.${entry.namespace}`, type)
    }
  }
  for (const [type, entry] of Object.entries(names.blocks)) {
    const owner = triggerMethodRoots.get(entry.namespace)
    if (owner) {
      issues.push(
        `${type}: namespace "${entry.namespace}" collides with ${owner}'s trigger methods`
      )
    }
  }

  for (const added of extendSdkNames(names, sources).added) issues.push(`missing ${added}`)

  for (const source of sources) {
    const entry = names.blocks[source.type]
    if (!entry) continue
    if (entry.namespace.startsWith(`${TRIGGER_ROOT}.`) && !source.triggerBlock) {
      issues.push(`${source.type}: namespace "${entry.namespace}" is only for trigger blocks`)
    }
    for (const surface of ['action', 'trigger'] as const) {
      const aliases = entry.paramAliases?.[surface] ?? {}
      const identities = new Map<string, Set<string>>()
      for (const param of source.params[surface]) {
        const name = aliases[param.name] ?? param.name
        const set = identities.get(name) ?? new Set<string>()
        set.add(param.identity)
        identities.set(name, set)
      }
      for (const [name, set] of identities) {
        if (set.size > 1) {
          issues.push(
            `${source.type}: ${surface} param "${name}" names ${[...set].sort(compareStrings).join(', ')}`
          )
        }
      }
      for (const name of Object.keys(aliases)) {
        if (!CREDENTIAL_ALIAS_SOURCES.has(name)) {
          issues.push(`${source.type}: ${surface} alias for "${name}" is not a credential alias`)
        }
      }
    }
  }

  return issues.sort(compareStrings)
}

/** The `operation` dropdown's static options across every declaration, in declared order. */
export function operationOptions(block: BlockConfig): Array<{ id: string; label: string }> {
  const seen = new Set<string>()
  const operations: Array<{ id: string; label: string }> = []
  for (const subBlock of block.subBlocks) {
    if (subBlock.id !== 'operation' || subBlock.type !== 'dropdown') continue
    if (isTriggerSurface(subBlock) || !Array.isArray(subBlock.options)) continue
    for (const option of subBlock.options) {
      const id = String(option.id)
      if (seen.has(id)) continue
      seen.add(id)
      operations.push({ id, label: typeof option.label === 'string' ? option.label : id })
    }
  }
  return operations
}

/** Reads the name-relevant facts off one registry block. */
export function sdkNameSource(
  block: BlockConfig,
  triggerProvider: (triggerId: string) => string | undefined
): SdkNameSource {
  const params: Record<SdkSurface, SdkParamSource[]> = { action: [], trigger: [] }
  for (const subBlock of block.subBlocks) {
    const surface: SdkSurface = isTriggerSurface(subBlock) ? 'trigger' : 'action'
    params[surface].push(
      subBlock.canonicalParamId
        ? { name: subBlock.canonicalParamId, identity: `pair:${subBlock.canonicalParamId}` }
        : { name: subBlock.id, identity: `id:${subBlock.id}` }
    )
  }
  const triggerBlock = block.category === 'triggers'
  const triggers =
    block.triggers?.enabled && !triggerBlock
      ? block.triggers.available.flatMap((id) => {
          const provider = triggerProvider(id)
          return provider === undefined ? [] : [{ id, provider }]
        })
      : []
  return {
    type: block.type,
    hidden: block.hideFromToolbar === true,
    triggerBlock,
    operations: operationOptions(block),
    triggers,
    params,
  }
}
