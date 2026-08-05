import { isPlainRecord } from '@sim/utils/object'

const MAX_SCHEMA_NODES = 100_000
const MAX_SCHEMA_DEPTH = 100
const SCHEMA_DISPLAY_KEYS = new Set(['description', 'title', '$comment', 'example', 'examples'])
const SCHEMA_SINGLE_CHILD_KEYS = new Set([
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])
const SCHEMA_ARRAY_CHILD_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_MAP_CHILD_KEYS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])

export type ModelVisibleSchemaAction =
  | 'preserve'
  | 'project'
  | 'traverse'
  | 'verify'
  | 'traverse-verify-key'

export class ModelVisibleSchemaError extends Error {
  constructor() {
    super('Model-visible schema content could not be safely projected')
    this.name = 'ModelVisibleSchemaError'
  }
}

export function getModelVisibleSchemaAction(
  parentKey: string | undefined,
  key: string,
  _value?: unknown
): ModelVisibleSchemaAction {
  if (parentKey !== undefined && SCHEMA_MAP_CHILD_KEYS.has(parentKey)) {
    return 'traverse-verify-key'
  }
  if (SCHEMA_DISPLAY_KEYS.has(key)) return 'project'
  if (
    SCHEMA_SINGLE_CHILD_KEYS.has(key) ||
    SCHEMA_ARRAY_CHILD_KEYS.has(key) ||
    SCHEMA_MAP_CHILD_KEYS.has(key)
  ) {
    return 'traverse'
  }
  return 'verify'
}

interface SchemaTraversalState {
  nodes: number
  ancestors: WeakSet<object>
}

function visitSchemaNode(state: SchemaTraversalState, depth: number): void {
  state.nodes += 1
  if (state.nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) {
    throw new ModelVisibleSchemaError()
  }
}

function schemaChildren(key: string, value: unknown): unknown[] {
  if (SCHEMA_SINGLE_CHILD_KEYS.has(key)) return [value]
  if (SCHEMA_ARRAY_CHILD_KEYS.has(key)) return Array.isArray(value) ? value : []
  if (SCHEMA_MAP_CHILD_KEYS.has(key) && isPlainRecord(value)) return Object.values(value)
  return []
}

export interface ModelVisibleSchemaContent {
  projectedValues: unknown[]
  guardedValues: unknown[]
}

/** Splits schema display text from semantic fields whose exact bytes must remain unchanged. */
export function collectModelVisibleSchemaContent(schema: unknown): ModelVisibleSchemaContent {
  const projectedValues: unknown[] = []
  const guardedValues: unknown[] = []
  const state: SchemaTraversalState = { nodes: 0, ancestors: new WeakSet<object>() }

  const visit = (candidate: unknown, depth: number): void => {
    visitSchemaNode(state, depth)
    if (!isPlainRecord(candidate)) return
    if (state.ancestors.has(candidate)) throw new ModelVisibleSchemaError()

    state.ancestors.add(candidate)
    try {
      for (const [key, value] of Object.entries(candidate)) {
        guardedValues.push(key)
        const action = getModelVisibleSchemaAction(undefined, key, value)
        if (action === 'project') {
          projectedValues.push(value)
          continue
        }
        if (action === 'verify') {
          guardedValues.push(value)
          continue
        }
        if (action !== 'traverse') continue
        if (SCHEMA_MAP_CHILD_KEYS.has(key) && isPlainRecord(value)) {
          for (const [childKey, child] of Object.entries(value)) {
            guardedValues.push(childKey)
            visit(child, depth + 1)
          }
          continue
        }
        for (const child of schemaChildren(key, value)) visit(child, depth + 1)
      }
    } finally {
      state.ancestors.delete(candidate)
    }
  }

  visit(schema, 0)
  return { projectedValues, guardedValues }
}

export function collectModelVisibleSchemaValues(schema: unknown): unknown[] {
  return collectModelVisibleSchemaContent(schema).projectedValues
}

export function restoreModelVisibleSchemaValues(schema: unknown, projected: unknown): unknown {
  if (!Array.isArray(projected)) throw new ModelVisibleSchemaError()
  const state: SchemaTraversalState = { nodes: 0, ancestors: new WeakSet<object>() }
  let cursor = 0

  const visit = (candidate: unknown, depth: number): unknown => {
    visitSchemaNode(state, depth)
    if (!isPlainRecord(candidate)) return candidate
    if (state.ancestors.has(candidate)) throw new ModelVisibleSchemaError()

    state.ancestors.add(candidate)
    try {
      let restored = candidate
      for (const [key, value] of Object.entries(candidate)) {
        const action = getModelVisibleSchemaAction(undefined, key, value)
        let nextValue = value
        if (action === 'project') {
          if (cursor >= projected.length) throw new ModelVisibleSchemaError()
          nextValue = projected[cursor]
          cursor += 1
        } else if (action === 'traverse' || action === 'traverse-verify-key') {
          if (SCHEMA_SINGLE_CHILD_KEYS.has(key)) {
            nextValue = visit(value, depth + 1)
          } else if (SCHEMA_ARRAY_CHILD_KEYS.has(key) && Array.isArray(value)) {
            nextValue = value.map((child) => visit(child, depth + 1))
          } else if (SCHEMA_MAP_CHILD_KEYS.has(key) && isPlainRecord(value)) {
            nextValue = Object.fromEntries(
              Object.entries(value).map(([childKey, child]) => [childKey, visit(child, depth + 1)])
            )
          }
        }

        if (nextValue !== value) {
          if (restored === candidate) restored = { ...candidate }
          restored[key] = nextValue
        }
      }
      return restored
    } finally {
      state.ancestors.delete(candidate)
    }
  }

  const restored = visit(schema, 0)
  if (cursor !== projected.length) throw new ModelVisibleSchemaError()
  return restored
}
