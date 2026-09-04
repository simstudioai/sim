import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'

const MAX_JSON_NESTING_DEPTH = 100
const MAX_JSON_NODE_COUNT = 100_000

interface JsonBudgetState {
  bytes: number
  nodes: number
  ancestors: WeakSet<object>
}

type JsonBudgetFrame =
  | { kind: 'value'; value: unknown; depth: number }
  | { kind: 'array'; value: unknown[]; index: number; depth: number }
  | {
      kind: 'object'
      value: Record<string, unknown>
      keys: string[]
      index: number
      depth: number
    }

/** Serializes a bounded request body containing only plain JSON data. */
export function serializeOracleFusionJsonBody(body: unknown): string {
  assertJsonBodyWithinLimit(body)
  const serialized = JSON.stringify(body)
  if (serialized === undefined) throwNonPlainJsonError()
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
    throwRequestBodyLimitError()
  }
  return serialized
}

function assertJsonBodyWithinLimit(body: unknown): void {
  const state: JsonBudgetState = {
    bytes: 0,
    nodes: 0,
    ancestors: new WeakSet<object>(),
  }
  const frames: JsonBudgetFrame[] = [{ kind: 'value', value: body, depth: 0 }]

  while (frames.length > 0) {
    const frame = frames.pop()
    if (!frame) break

    if (frame.kind === 'array') {
      if (frame.index >= frame.value.length) {
        addJsonBytes(state, 1)
        state.ancestors.delete(frame.value)
        continue
      }
      if (frame.index > 0) addJsonBytes(state, 1)
      const descriptor = Object.getOwnPropertyDescriptor(frame.value, String(frame.index))
      if (!descriptor || descriptor.get || descriptor.set) throwNonPlainJsonError()
      frames.push({ ...frame, index: frame.index + 1 })
      frames.push({
        kind: 'value',
        value: descriptor.value,
        depth: frame.depth + 1,
      })
      continue
    }

    if (frame.kind === 'object') {
      if (frame.index >= frame.keys.length) {
        addJsonBytes(state, 1)
        state.ancestors.delete(frame.value)
        continue
      }
      const key = frame.keys[frame.index]
      const descriptor = Object.getOwnPropertyDescriptor(frame.value, key)
      if (!descriptor || descriptor.get || descriptor.set) throwNonPlainJsonError()
      if (frame.index > 0) addJsonBytes(state, 1)
      addJsonBytes(state, jsonStringByteLength(key) + 1)
      frames.push({ ...frame, index: frame.index + 1 })
      frames.push({
        kind: 'value',
        value: descriptor.value,
        depth: frame.depth + 1,
      })
      continue
    }

    admitJsonNode(state)
    const { value, depth } = frame
    if (depth > MAX_JSON_NESTING_DEPTH) {
      throw new Error('Oracle Fusion request body exceeds the JSON nesting limit')
    }
    if (value === null) {
      addJsonBytes(state, 4)
    } else if (typeof value === 'string') {
      addJsonBytes(state, jsonStringByteLength(value))
    } else if (typeof value === 'boolean') {
      addJsonBytes(state, value ? 4 : 5)
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throwNonPlainJsonError()
      addJsonBytes(state, JSON.stringify(value).length)
    } else if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throwNonPlainJsonError()
      assertContainerIsPlain(value)
      if (state.ancestors.has(value)) {
        throw new Error('Oracle Fusion request body must not be cyclic')
      }
      if (value.length * 2 + 1 > MAX_INLINE_MATERIALIZATION_BYTES - state.bytes) {
        throwRequestBodyLimitError()
      }
      state.ancestors.add(value)
      addJsonBytes(state, 1)
      frames.push({ kind: 'array', value, index: 0, depth })
    } else if (isRecordLike(value)) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) throwNonPlainJsonError()
      assertContainerIsPlain(value)
      if (state.ancestors.has(value)) {
        throw new Error('Oracle Fusion request body must not be cyclic')
      }
      state.ancestors.add(value)
      addJsonBytes(state, 1)
      frames.push({
        kind: 'object',
        value,
        keys: Object.keys(value),
        index: 0,
        depth,
      })
    } else {
      throwNonPlainJsonError()
    }
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertContainerIsPlain(value: object): void {
  for (
    let candidate: object | null = value;
    candidate;
    candidate = Object.getPrototypeOf(candidate)
  ) {
    if (Object.hasOwn(candidate, 'toJSON')) throwNonPlainJsonError()
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throwNonPlainJsonError()
    if (key === 'length' && Array.isArray(value)) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.get || descriptor?.set) throwNonPlainJsonError()
    if (Array.isArray(value)) {
      const index = Number(key)
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        String(index) !== key ||
        index >= value.length
      ) {
        throwNonPlainJsonError()
      }
    }
  }
}

function admitJsonNode(state: JsonBudgetState): void {
  state.nodes += 1
  if (state.nodes > MAX_JSON_NODE_COUNT) {
    throw new Error('Oracle Fusion request body exceeds the JSON complexity limit')
  }
}

function addJsonBytes(state: JsonBudgetState, bytes: number): void {
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
  throw new Error('Oracle Fusion request body exceeds the inline payload limit')
}

function throwNonPlainJsonError(): never {
  throw new Error(
    'Oracle Fusion request body must contain plain JSON data without accessors or custom serialization'
  )
}
