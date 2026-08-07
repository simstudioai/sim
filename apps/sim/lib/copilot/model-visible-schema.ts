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
const SCHEMA_TYPE_NAMES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
])
const SCHEMA_BOOLEAN_CONTROL_KEYS = new Set([
  'deprecated',
  'nullable',
  'readOnly',
  'uniqueItems',
  'writeOnly',
])
const SCHEMA_NUMBER_CONTROL_KEYS = new Set([
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf',
])
const SCHEMA_NONNEGATIVE_INTEGER_CONTROL_KEYS = new Set([
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
])
const SCHEMA_KNOWN_KEYS = new Set([
  '$anchor',
  '$comment',
  '$defs',
  '$dynamicAnchor',
  '$dynamicRef',
  '$id',
  '$ref',
  '$schema',
  '$vocabulary',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'default',
  'definitions',
  'deprecated',
  'dependentRequired',
  'dependentSchemas',
  'description',
  'else',
  'enum',
  'example',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'if',
  'items',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'nullable',
  'oneOf',
  'pattern',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'readOnly',
  'required',
  'then',
  'title',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
  'writeOnly',
])

export type ModelVisibleSchemaAction =
  | 'preserve'
  | 'project'
  | 'traverse'
  | 'verify'
  | 'traverse-verify-key'
  | 'verify-key-value'

export class ModelVisibleSchemaError extends Error {
  constructor() {
    super('Model-visible schema content could not be safely projected')
    this.name = 'ModelVisibleSchemaError'
  }
}

export function getModelVisibleSchemaAction(
  parentKey: string | undefined,
  key: string,
  value?: unknown
): ModelVisibleSchemaAction {
  if (parentKey !== undefined && SCHEMA_MAP_CHILD_KEYS.has(parentKey)) {
    return isSchemaNode(value) ? 'traverse-verify-key' : 'verify-key-value'
  }
  if (SCHEMA_DISPLAY_KEYS.has(key)) return 'project'
  if (SCHEMA_SINGLE_CHILD_KEYS.has(key)) return isSchemaNode(value) ? 'traverse' : 'verify'
  if (SCHEMA_ARRAY_CHILD_KEYS.has(key)) return Array.isArray(value) ? 'traverse' : 'verify'
  if (SCHEMA_MAP_CHILD_KEYS.has(key)) return isPlainRecord(value) ? 'traverse' : 'verify'
  if (isPublicSchemaControl(key, value)) return 'preserve'
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

function isSchemaNode(value: unknown): value is boolean | Record<string, unknown> {
  return typeof value === 'boolean' || isPlainRecord(value)
}

function isPublicSchemaControl(key: string, value: unknown): boolean {
  if (key === 'type') {
    if (typeof value === 'string') return SCHEMA_TYPE_NAMES.has(value)
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && SCHEMA_TYPE_NAMES.has(item))
    )
  }
  if (SCHEMA_BOOLEAN_CONTROL_KEYS.has(key)) return typeof value === 'boolean'
  if (SCHEMA_NUMBER_CONTROL_KEYS.has(key)) {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (SCHEMA_NONNEGATIVE_INTEGER_CONTROL_KEYS.has(key)) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
  }
  return false
}

function schemaRecordEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  const keys = Reflect.ownKeys(value)
  if (keys.length > MAX_SCHEMA_NODES) throw new ModelVisibleSchemaError()
  const entries: Array<[string, unknown]> = []
  for (const key of keys) {
    if (typeof key !== 'string') throw new ModelVisibleSchemaError()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new ModelVisibleSchemaError()
    }
    entries.push([key, descriptor.value])
  }
  return entries
}

function schemaArrayValues(value: unknown[]): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw new ModelVisibleSchemaError()
  if (value.length > MAX_SCHEMA_NODES) throw new ModelVisibleSchemaError()
  const values = new Array<unknown>(value.length)
  let entries = 0
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (typeof key !== 'string') throw new ModelVisibleSchemaError()
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new ModelVisibleSchemaError()
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new ModelVisibleSchemaError()
    }
    values[index] = descriptor.value
    entries += 1
  }
  if (entries !== value.length) throw new ModelVisibleSchemaError()
  return values
}

function schemaChildren(key: string, value: unknown): unknown[] {
  if (SCHEMA_SINGLE_CHILD_KEYS.has(key)) return [value]
  if (SCHEMA_ARRAY_CHILD_KEYS.has(key)) {
    if (!Array.isArray(value)) throw new ModelVisibleSchemaError()
    return schemaArrayValues(value)
  }
  if (SCHEMA_MAP_CHILD_KEYS.has(key)) {
    if (!isPlainRecord(value)) throw new ModelVisibleSchemaError()
    return schemaRecordEntries(value).map(([, child]) => child)
  }
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
    if (typeof candidate === 'boolean') return
    if (!isPlainRecord(candidate)) throw new ModelVisibleSchemaError()
    if (state.ancestors.has(candidate)) throw new ModelVisibleSchemaError()

    state.ancestors.add(candidate)
    try {
      for (const [key, value] of schemaRecordEntries(candidate)) {
        const action = getModelVisibleSchemaAction(undefined, key, value)
        if (action === 'project') {
          projectedValues.push(value)
          continue
        }
        if (action === 'preserve') continue
        if (action === 'verify') {
          if (
            SCHEMA_SINGLE_CHILD_KEYS.has(key) ||
            SCHEMA_ARRAY_CHILD_KEYS.has(key) ||
            SCHEMA_MAP_CHILD_KEYS.has(key)
          ) {
            throw new ModelVisibleSchemaError()
          }
          if (!SCHEMA_KNOWN_KEYS.has(key)) guardedValues.push(key)
          guardedValues.push(value)
          continue
        }
        if (action !== 'traverse') continue
        if (SCHEMA_MAP_CHILD_KEYS.has(key)) {
          if (!isPlainRecord(value)) throw new ModelVisibleSchemaError()
          for (const [childKey, child] of schemaRecordEntries(value)) {
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
    if (typeof candidate === 'boolean') return candidate
    if (!isPlainRecord(candidate)) throw new ModelVisibleSchemaError()
    if (state.ancestors.has(candidate)) throw new ModelVisibleSchemaError()

    state.ancestors.add(candidate)
    try {
      let restored = candidate
      for (const [key, value] of schemaRecordEntries(candidate)) {
        const action = getModelVisibleSchemaAction(undefined, key, value)
        let nextValue = value
        if (action === 'project') {
          if (cursor >= projected.length) throw new ModelVisibleSchemaError()
          nextValue = projected[cursor]
          cursor += 1
        } else if (
          action === 'verify' &&
          (SCHEMA_SINGLE_CHILD_KEYS.has(key) ||
            SCHEMA_ARRAY_CHILD_KEYS.has(key) ||
            SCHEMA_MAP_CHILD_KEYS.has(key))
        ) {
          throw new ModelVisibleSchemaError()
        } else if (action === 'traverse' || action === 'traverse-verify-key') {
          if (SCHEMA_SINGLE_CHILD_KEYS.has(key)) {
            nextValue = visit(value, depth + 1)
          } else if (SCHEMA_ARRAY_CHILD_KEYS.has(key)) {
            if (!Array.isArray(value)) throw new ModelVisibleSchemaError()
            nextValue = schemaArrayValues(value).map((child) => visit(child, depth + 1))
          } else if (SCHEMA_MAP_CHILD_KEYS.has(key)) {
            if (!isPlainRecord(value)) throw new ModelVisibleSchemaError()
            nextValue = Object.fromEntries(
              schemaRecordEntries(value).map(([childKey, child]) => [
                childKey,
                visit(child, depth + 1),
              ])
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
