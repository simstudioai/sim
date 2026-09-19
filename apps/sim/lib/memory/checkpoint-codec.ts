import { isRecordLike } from '@sim/utils/object'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

/** Hex ciphertext plus authentication overhead stays below the 4 MiB turn-state storage cap. */
export const MAX_MEMORY_CHECKPOINT_BYTES = 2 * 1024 * 1024 - 1024
const MAX_ENCRYPTED_CHECKPOINT_BYTES = MAX_MEMORY_CHECKPOINT_BYTES * 2 + 1024
const MAX_CHECKPOINT_NODES = 100_000
const MAX_CHECKPOINT_DEPTH = 64

interface ByteField {
  path: string[]
  base64: string
}

interface CheckpointEnvelope {
  version: 1
  data: unknown
  bytes: ByteField[]
}

/** Produces bounded JSON for secret projection without interpreting opaque provider bytes. */
export function projectableMemoryCheckpoint(value: unknown): CheckpointEnvelope {
  const bytes: ByteField[] = []
  const ancestors = new WeakSet<object>()
  let nodes = 0
  let minimumBytes = 0
  const reserve = (size: number) => {
    minimumBytes += size
    if (minimumBytes > MAX_MEMORY_CHECKPOINT_BYTES)
      throw new Error('Memory checkpoint exceeds its byte limit')
  }
  const visit = (item: unknown, path: string[]): unknown => {
    if (++nodes > MAX_CHECKPOINT_NODES || path.length > MAX_CHECKPOINT_DEPTH)
      throw new Error('Memory checkpoint exceeds its traversal limit')
    if (typeof item === 'string') {
      reserve(Buffer.byteLength(item, 'utf8') + 2)
      return item
    }
    if (item instanceof Uint8Array) {
      reserve(Math.ceil(item.byteLength / 3) * 4 + 32)
      for (const part of path) reserve(Buffer.byteLength(part, 'utf8') + 3)
      bytes.push({ path, base64: Buffer.from(item).toString('base64') })
      return null
    }
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) throw new Error('Memory checkpoint contains a cycle')
      if ('toJSON' in item) throw new Error('Memory checkpoint contains a custom serializer')
      const prototype = Object.getPrototypeOf(item)
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
        throw new Error('Memory checkpoint contains a non-JSON value')
      ancestors.add(item)
      reserve(2)
      let result: unknown
      if (Array.isArray(item)) {
        if (item.length > MAX_CHECKPOINT_NODES - nodes)
          throw new Error('Memory checkpoint exceeds its traversal limit')
        const array: unknown[] = []
        for (let index = 0; index < item.length; index++) {
          const field = Object.getOwnPropertyDescriptor(item, index)
          if (field && !('value' in field))
            throw new Error('Memory checkpoint contains an accessor')
          reserve(1)
          array.push(visit(field?.value, [...path, String(index)]))
        }
        result = array
      } else {
        const object: Record<string, unknown> = Object.create(null)
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue
          const field = Object.getOwnPropertyDescriptor(item, key)
          if (!field || !('value' in field))
            throw new Error('Memory checkpoint contains an accessor')
          reserve(Buffer.byteLength(key, 'utf8') + 4)
          object[key] = visit(field.value, [...path, key])
        }
        result = object
      }
      ancestors.delete(item)
      return result
    }
    if (
      item !== null &&
      item !== undefined &&
      typeof item !== 'boolean' &&
      typeof item !== 'number'
    )
      throw new Error('Memory checkpoint contains a non-JSON value')
    reserve(24)
    return item
  }
  return { version: 1, data: visit(value, []), bytes }
}

/** Explicit byte paths preserve Bedrock's signatures without interpreting user JSON as bytes. */
export async function encryptMemoryCheckpoint(value: unknown): Promise<string> {
  const encoded = JSON.stringify(projectableMemoryCheckpoint(value))
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MEMORY_CHECKPOINT_BYTES)
    throw new Error('Memory checkpoint exceeds its byte limit')
  return (await encryptSecret(encoded)).encrypted
}

export async function decryptMemoryCheckpoint(encrypted: string): Promise<unknown> {
  if (Buffer.byteLength(encrypted, 'utf8') > MAX_ENCRYPTED_CHECKPOINT_BYTES)
    throw new Error('Memory checkpoint exceeds its byte limit')
  const { decrypted } = await decryptSecret(encrypted, { logFailure: false })
  if (Buffer.byteLength(decrypted, 'utf8') > MAX_MEMORY_CHECKPOINT_BYTES)
    throw new Error('Memory checkpoint exceeds its byte limit')
  return restoreMemoryCheckpoint(JSON.parse(decrypted))
}

/** Decodes the same bounded byte envelope inside an already encrypted memory artifact. */
export function restoreMemoryCheckpoint(encoded: unknown): unknown {
  const envelope: unknown = structuredClone(encoded)
  if (
    !isRecordLike(envelope) ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.bytes) ||
    envelope.bytes.length > MAX_CHECKPOINT_NODES
  )
    throw new Error('Unsupported memory checkpoint')
  for (const field of envelope.bytes) {
    if (
      !isRecordLike(field) ||
      !Array.isArray(field.path) ||
      typeof field.base64 !== 'string' ||
      field.path.length > MAX_CHECKPOINT_DEPTH ||
      field.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(field.base64)
    )
      throw new Error('Invalid checkpoint byte field')
    const value = new Uint8Array(Buffer.from(field.base64, 'base64'))
    if (field.path.length === 0) {
      if (envelope.data !== null) throw new Error('Invalid checkpoint byte destination')
      envelope.data = value
      continue
    }
    let parent: unknown = envelope.data
    for (const key of field.path.slice(0, -1)) {
      if (
        typeof key !== 'string' ||
        !parent ||
        typeof parent !== 'object' ||
        !Object.hasOwn(parent, key)
      )
        throw new Error('Invalid checkpoint byte path')
      parent = Reflect.get(parent, key)
    }
    const key: unknown = field.path.at(-1)
    if (
      typeof key !== 'string' ||
      !parent ||
      typeof parent !== 'object' ||
      !Object.hasOwn(parent, key) ||
      Reflect.get(parent, key) !== null
    )
      throw new Error('Invalid checkpoint byte destination')
    Object.defineProperty(parent, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  projectableMemoryCheckpoint(envelope.data)
  return envelope.data
}
