import { createHash } from 'node:crypto'
import type { Data } from '#design-diff/types'

interface ValueIdentity {
  sha256: string
  bytes: number
}

/** Hash immutable symbolic values as trees without expanding repeated object references. */
export class SemanticValues {
  private readonly identities = new WeakMap<object, ValueIdentity>()

  identity(value: Data): ValueIdentity {
    if (value === null || typeof value !== 'object') {
      const json = JSON.stringify(value) ?? 'null'
      return {
        sha256: createHash('sha256').update(`literal:${json}`).digest('hex'),
        bytes: Buffer.byteLength(json),
      }
    }
    const cached = this.identities.get(value)
    if (cached) return cached
    const hash = createHash('sha256').update(Array.isArray(value) ? 'array:' : 'object:')
    let bytes = 2
    const entries = Array.isArray(value)
      ? Array.from(value, (item) => [null, item ?? null] as const)
      : Object.entries(value).filter(([, item]) => item !== undefined)
    for (const [index, [key, child]] of entries.entries()) {
      const identity = this.identity(child)
      const property = key === null ? '' : `${JSON.stringify(key)}:`
      hash.update(property).update(identity.sha256).update(';')
      bytes += (index ? 1 : 0) + Buffer.byteLength(property) + identity.bytes
    }
    if (!Number.isSafeInteger(bytes)) throw new Error('Symbolic value exceeds safe size accounting')
    const identity = { sha256: hash.digest('hex'), bytes }
    this.identities.set(value, identity)
    return identity
  }
}

/** Yield JSON in source order so a preview can stop before traversing repeated large values. */
function* jsonParts(value: Data): Generator<string> {
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value) ?? 'null'
    return
  }
  const array = Array.isArray(value)
  yield array ? '[' : '{'
  const entries = array
    ? Array.from(value, (item) => [null, item ?? null] as const)
    : Object.entries(value).filter(([, item]) => item !== undefined)
  for (const [index, [key, child]] of entries.entries()) {
    if (index) yield ','
    if (key !== null) yield `${JSON.stringify(key)}:`
    yield* jsonParts(child)
  }
  yield array ? ']' : '}'
}

/** Keep a bounded UTF-8 prefix without allocating the complete serialized expression. */
export function valuePrefix(value: Data, limit: number): string {
  const parts: Buffer[] = []
  let bytes = 0
  for (const part of jsonParts(value)) {
    const buffer = Buffer.from(part)
    let end = Math.min(limit - bytes, buffer.length)
    while (end && end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--
    parts.push(buffer.subarray(0, end))
    bytes += end
    if (end < buffer.length || bytes === limit) break
  }
  return Buffer.concat(parts).toString('utf8')
}
