/**
 * Shared fixtures for the materialize and diff tests: a catalog hand-projected from real registry
 * configs (apps/sim/blocks/blocks: slack.ts, agent.ts, condition.ts, router_v2.ts, function.ts,
 * variables.ts, api.ts, start_trigger.ts, knowledge.ts, schedule.ts) down to the fields
 * canonicalize and materialize read, stored-state builders, and deterministic hooks.
 */

import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { canonicalize } from '../canonicalize'
import type { BlockCatalog, CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
import type { WorkflowLockV1 } from '../lock'
import type { CanonicalWorkflow, ResourceKeyResolver } from '../model'
import type { MaterializeHooks } from './context'

function sb(
  fields: Partial<CatalogSubBlock> & Pick<CatalogSubBlock, 'id' | 'type'>
): CatalogSubBlock {
  return { valueKind: 'string', storage: 'native', ...fields }
}

function block(
  type: string,
  subBlocks: CatalogSubBlock[],
  extra: Partial<CatalogBlock> = {}
): CatalogBlock {
  return {
    type,
    name: type,
    category: 'blocks',
    subBlocks,
    tools: { access: [], selector: 'single' },
    outputs: {},
    graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    ...extra,
  }
}

const BRANCH_GRAPH = { canBeTarget: true, errorPort: false, container: null, annotationOnly: false }

export const CATALOG: BlockCatalog = {
  catalogVersion: 1,
  hash: 'fixture',
  sdkMajor: 1,
  builders: {},
  triggers: {},
  blocks: {
    slack: block('slack', [
      sb({ id: 'operation', type: 'dropdown' }),
      sb({
        id: 'credential',
        type: 'oauth-input',
        canonicalParamId: 'oauthCredential',
        mode: 'basic',
        valueKind: 'resource',
        resourceKind: 'credential',
      }),
      sb({
        id: 'manualCredential',
        type: 'short-input',
        canonicalParamId: 'oauthCredential',
        mode: 'advanced',
      }),
      sb({
        id: 'channel',
        type: 'channel-selector',
        canonicalParamId: 'channel',
        mode: 'basic',
        valueKind: 'picked',
      }),
      sb({
        id: 'manualChannel',
        type: 'short-input',
        canonicalParamId: 'channel',
        mode: 'advanced',
      }),
      sb({ id: 'text', type: 'long-input', condition: { field: 'operation', value: 'send' } }),
      sb({ id: 'threadTs', type: 'short-input', mode: 'advanced' }),
      sb({ id: 'notify', type: 'switch', valueKind: 'boolean', valueShape: 'boolean' }),
      sb({ id: 'botToken', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      sb({ id: 'webhookId', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      sb({ id: 'triggerPath', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
      sb({ id: 'triggerConfig', type: 'short-input', mode: 'trigger', surface: 'trigger' }),
    ]),
    agent: block('agent', [
      sb({ id: 'messages', type: 'messages-input', valueKind: 'json' }),
      sb({ id: 'model', type: 'combobox' }),
      sb({
        id: 'tools',
        type: 'tool-input',
        valueKind: 'tools',
        structured: 'tools',
        storage: 'json-string',
      }),
      sb({ id: 'responseFormat', type: 'code', valueKind: 'code', language: 'json' }),
    ]),
    knowledge: block('knowledge', [
      sb({
        id: 'knowledgeBaseIds',
        type: 'knowledge-base-selector',
        multiple: true,
        valueShape: 'json',
        valueKind: 'resource',
        resourceKind: 'knowledge-base',
      }),
      sb({
        id: 'tagFilters',
        type: 'knowledge-tag-filters',
        valueKind: 'json',
        storage: 'json-string',
      }),
    ]),
    condition: block(
      'condition',
      [
        sb({
          id: 'conditions',
          type: 'condition-input',
          valueKind: 'branches',
          structured: 'branches',
          storage: 'json-string',
        }),
      ],
      { graph: { ...BRANCH_GRAPH, branches: { subBlockId: 'conditions', kind: 'condition' } } }
    ),
    router_v2: block(
      'router_v2',
      [
        sb({ id: 'context', type: 'long-input' }),
        sb({
          id: 'routes',
          type: 'router-input',
          valueKind: 'branches',
          structured: 'branches',
          storage: 'json-string',
        }),
      ],
      { graph: { ...BRANCH_GRAPH, branches: { subBlockId: 'routes', kind: 'router' } } }
    ),
    function: block('function', [
      sb({ id: 'language', type: 'dropdown' }),
      sb({ id: 'code', type: 'code', valueKind: 'code' }),
    ]),
    function_v0: block('function_v0', [sb({ id: 'code', type: 'code', valueKind: 'code' })], {
      lifecycle: { sunset: { status: 'legacy', replacedBy: 'function' } },
    }),
    variables: block('variables', [
      sb({ id: 'variables', type: 'variables-input', valueKind: 'json', structured: 'variables' }),
    ]),
    api: block('api', [
      sb({ id: 'url', type: 'short-input' }),
      sb({
        id: 'headers',
        type: 'table',
        valueKind: 'array',
        structured: 'tableRows',
        valueShape: 'json',
        columns: ['Key', 'Value'],
      }),
    ]),
    start_trigger: block(
      'start_trigger',
      [
        sb({
          id: 'inputFormat',
          type: 'input-format',
          valueKind: 'array',
          structured: 'inputFormat',
        }),
      ],
      { category: 'triggers' }
    ),
    schedule: block(
      'schedule',
      [
        sb({ id: 'scheduleType', type: 'dropdown' }),
        sb({ id: 'cronExpression', type: 'short-input' }),
      ],
      { category: 'triggers' }
    ),
  },
}

/** Deterministic hooks: sequential ids, editor-like new blocks, and a marker output shape. */
export function fixtureHooks(prefix = 'new'): MaterializeHooks & { minted: string[] } {
  let next = 0
  const minted: string[] = []
  return {
    minted,
    newId: () => {
      next += 1
      const id = `${prefix}-${next}`
      minted.push(id)
      return id
    },
    initBlock: ({ id, type, name, triggerMode }) => {
      const config = catalogBlock(CATALOG, type)
      const subBlocks: BlockState['subBlocks'] = {}
      for (const subBlock of config?.subBlocks ?? []) {
        subBlocks[subBlock.id] = { id: subBlock.id, type: subBlock.type, value: null }
      }
      if (type === 'condition') {
        subBlocks.conditions = {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify([
            { id: 'seed-if', title: 'if', value: '' },
            { id: 'seed-else', title: 'else', value: '' },
          ]),
        }
      }
      if (type === 'function') subBlocks.language.value = 'javascript'
      return {
        id,
        type,
        name,
        position: { x: 0, y: 0 },
        enabled: true,
        horizontalHandles: true,
        advancedMode: false,
        height: 0,
        triggerMode,
        subBlocks,
        outputs: { seeded: { type: 'string' } },
        data: {},
        locked: false,
      }
    },
    computeOutputs: (stored) => ({
      computed: { type: 'string', description: `${stored.type}:${stored.triggerMode === true}` },
    }),
  }
}

type Values = Record<string, unknown>

export function blockState(
  id: string,
  type: string,
  name: string,
  values: Values = {},
  extra: Partial<BlockState> = {}
): BlockState {
  const subBlocks: BlockState['subBlocks'] = {}
  for (const [subBlockId, value] of Object.entries(values)) {
    const declared = catalogBlock(CATALOG, type)?.subBlocks.find((s) => s.id === subBlockId)
    subBlocks[subBlockId] = {
      id: subBlockId,
      type: declared?.type ?? 'short-input',
      value: value as never,
    }
  }
  return {
    id,
    type,
    name,
    position: { x: 10, y: 20 },
    subBlocks,
    outputs: { stored: { type: 'string' } },
    enabled: true,
    ...extra,
  }
}

export function workflowState(
  blocks: BlockState[],
  extra: Partial<WorkflowState> = {}
): WorkflowState {
  return {
    blocks: Object.fromEntries(blocks.map((b) => [b.id, b])),
    edges: [],
    loops: {},
    parallels: {},
    ...extra,
  }
}

export function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null = 'source',
  extra: Record<string, unknown> = {}
): WorkflowState['edges'][number] {
  return { id, source, target, sourceHandle, targetHandle: 'target', type: 'default', ...extra }
}

const META = { name: 'Fixture', description: null }

export const RESOURCES: ResourceKeyResolver = {
  toKey: (kind, id) => (id.startsWith('missing') ? null : `${kind}:${id}`),
  toId: (kind, key) => (key.startsWith(`${kind}:`) ? key.slice(kind.length + 1) : null),
}

export function canonical(state: WorkflowState, lock?: WorkflowLockV1 | null) {
  return canonicalize(state, { catalog: CATALOG, meta: META, lock, resources: RESOURCES })
}

/** A fresh lock for `state`, as `source get` would hand out: identity plus key-derived idents. */
export function lockFor(state: WorkflowState): WorkflowLockV1 {
  const { identity, layout } = canonical(state)
  const blocks: WorkflowLockV1['blocks'] = {}
  Object.entries(identity.blocks).forEach(([key, entry], order) => {
    blocks[key] = { ...entry, ident: `b_${key.replace(/[^A-Za-z0-9_$]/g, '_')}`, order }
    if (layout[key]) blocks[key].layout = layout[key]
  })
  return { version: 1, blocks, variables: identity.variables }
}

function copyJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, copyJson(member)]))
}

/** A deep copy of a CWM to edit as a draft (the package has no DOM or Node globals). */
export function draftOf(workflow: CanonicalWorkflow): CanonicalWorkflow {
  return copyJson(workflow) as CanonicalWorkflow
}
