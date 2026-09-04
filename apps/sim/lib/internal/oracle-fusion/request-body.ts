import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'

const MAX_JSON_NESTING_DEPTH = 100
const MAX_JSON_NODE_COUNT = 100_000

class OracleFusionRequestBodyError extends Error {}

interface JsonBudgetState {
  bytes: number
  nodes: number
  ancestors: WeakSet<object>
  fragments: string[]
}

type JsonBudgetFrame =
  | { kind: 'value'; value: unknown; depth: number }
  | {
      kind: 'array'
      owner: unknown[]
      values: unknown[]
      index: number
      depth: number
    }
  | {
      kind: 'object'
      owner: Record<string, unknown>
      entries: [string, unknown][]
      index: number
      depth: number
    }

/** Serializes a bounded request body containing only plain JSON data. */
export function serializeOracleFusionJsonBody(body: unknown): string {
  try {
    const state = serializeJsonBodyWithinLimit(body)
    const serialized = state.fragments.join('')
    if (Buffer.byteLength(serialized, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
      throwRequestBodyLimitError()
    }
    return serialized
  } catch (error) {
    if (error instanceof OracleFusionRequestBodyError) throw error
    throwNonPlainJsonError()
  }
}

function serializeJsonBodyWithinLimit(body: unknown): JsonBudgetState {
  const state: JsonBudgetState = {
    bytes: 0,
    nodes: 0,
    ancestors: new WeakSet<object>(),
    fragments: [],
  }
  const frames: JsonBudgetFrame[] = [{ kind: 'value', value: body, depth: 0 }]

  while (frames.length > 0) {
    const frame = frames.pop()
    if (!frame) break

    if (frame.kind === 'array') {
      if (frame.index >= frame.values.length) {
        appendJsonFragment(state, ']')
        state.ancestors.delete(frame.owner)
        continue
      }
      if (frame.index > 0) appendJsonFragment(state, ',')
      frames.push({ ...frame, index: frame.index + 1 })
      frames.push({
        kind: 'value',
        value: frame.values[frame.index],
        depth: frame.depth + 1,
      })
      continue
    }

    if (frame.kind === 'object') {
      if (frame.index >= frame.entries.length) {
        appendJsonFragment(state, '}')
        state.ancestors.delete(frame.owner)
        continue
      }
      const [key, value] = frame.entries[frame.index]
      if (frame.index > 0) appendJsonFragment(state, ',')
      appendJsonString(state, key)
      appendJsonFragment(state, ':')
      frames.push({ ...frame, index: frame.index + 1 })
      frames.push({ kind: 'value', value, depth: frame.depth + 1 })
      continue
    }

    admitJsonNode(state)
    const { value, depth } = frame
    if (depth > MAX_JSON_NESTING_DEPTH) {
      throw new OracleFusionRequestBodyError(
        'Oracle Fusion request body exceeds the JSON nesting limit'
      )
    }
    if (value === null) {
      appendJsonFragment(state, 'null')
    } else if (typeof value === 'string') {
      appendJsonString(state, value)
    } else if (typeof value === 'boolean') {
      appendJsonFragment(state, value ? 'true' : 'false')
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throwNonPlainJsonError()
      appendJsonFragment(state, JSON.stringify(value))
    } else if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Array.prototype) throwNonPlainJsonError()
      if (state.ancestors.has(value)) {
        throw new OracleFusionRequestBodyError('Oracle Fusion request body must not be cyclic')
      }
      const values = captureArrayValues(value, prototype)
      if (values.length * 2 + 1 > MAX_INLINE_MATERIALIZATION_BYTES - state.bytes) {
        throwRequestBodyLimitError()
      }
      state.ancestors.add(value)
      appendJsonFragment(state, '[')
      frames.push({ kind: 'array', owner: value, values, index: 0, depth })
    } else if (isRecordLike(value)) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throwNonPlainJsonError()
      if (state.ancestors.has(value)) {
        throw new OracleFusionRequestBodyError('Oracle Fusion request body must not be cyclic')
      }
      const entries = captureObjectEntries(value, prototype)
      state.ancestors.add(value)
      appendJsonFragment(state, '{')
      frames.push({ kind: 'object', owner: value, entries, index: 0, depth })
    } else {
      throwNonPlainJsonError()
    }
  }

  return state
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectInheritedJsonSerialization(prototype: object | null): void {
  for (let candidate = prototype; candidate; candidate = Object.getPrototypeOf(candidate)) {
    if (Object.hasOwn(candidate, 'toJSON')) throwNonPlainJsonError()
  }
}

function captureArrayValues(value: unknown[], prototype: object): unknown[] {
  rejectInheritedJsonSerialization(prototype)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length > MAX_JSON_NODE_COUNT + 1) throwComplexityLimitError()
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  const length = lengthDescriptor?.value
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length >= MAX_JSON_NODE_COUNT
  ) {
    throwComplexityLimitError()
  }
  const values = new Array<unknown>(length)
  let captured = 0

  for (const key of ownKeys) {
    if (typeof key === 'symbol') throwNonPlainJsonError()
    if (key === 'length') continue
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= length) {
      throwNonPlainJsonError()
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.get || descriptor.set) throwNonPlainJsonError()
    values[index] = descriptor.value
    captured += 1
  }

  if (captured !== length) throwNonPlainJsonError()
  return values
}

function captureObjectEntries(
  value: Record<string, unknown>,
  prototype: object | null
): [string, unknown][] {
  rejectInheritedJsonSerialization(prototype)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length > MAX_JSON_NODE_COUNT) throwComplexityLimitError()
  const entries: [string, unknown][] = []

  for (const key of ownKeys) {
    if (typeof key === 'symbol' || key === 'toJSON') throwNonPlainJsonError()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.get || descriptor.set) throwNonPlainJsonError()
    if (descriptor.enumerable) entries.push([key, descriptor.value])
  }

  return entries
}

function admitJsonNode(state: JsonBudgetState): void {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODE_COUNT) throwComplexityLimitError()
}

function appendJsonFragment(state: JsonBudgetState, fragment: string): void {
  reserveJsonBytes(state, Buffer.byteLength(fragment, 'utf8'))
  state.fragments.push(fragment)
}

function appendJsonString(state: JsonBudgetState, value: string): void {
  reserveJsonBytes(state, jsonStringByteLength(value))
  state.fragments.push(JSON.stringify(value))
}

function reserveJsonBytes(state: JsonBudgetState, bytes: number): void {
  state.bytes += bytes
  if (state.bytes > MAX_INLINE_MATERIALIZATION_BYTES) throwRequestBodyLimitError()
}

function jsonStringByteLength(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      bytes += 2
    } else if (code < 0x20) {
      bytes +=
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
    } else if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function throwRequestBodyLimitError(): never {
  throw new OracleFusionRequestBodyError(
    'Oracle Fusion request body exceeds the inline payload limit'
  )
}

function throwComplexityLimitError(): never {
  throw new OracleFusionRequestBodyError(
    'Oracle Fusion request body exceeds the JSON complexity limit'
  )
}

function throwNonPlainJsonError(): never {
  throw new OracleFusionRequestBodyError(
    'Oracle Fusion request body must contain plain JSON data without accessors or custom serialization'
  )
}
