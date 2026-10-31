import { isRecordLike, toRecord } from '@sim/utils/object'

export interface OutputNode {
  key: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  value?: string
  children?: OutputNode[]
  expanded?: boolean
  highlight?: boolean
}

function decodeNode(value: unknown): unknown {
  const node = toRecord(value)
  if (node.type === 'null') return null
  if (Array.isArray(node.children)) {
    return node.type === 'array' ? node.children.map(decodeNode) : decodeOutputValues(node.children)
  }
  if (node.value === undefined) return undefined
  if (typeof node.value !== 'string') throw new Error('Output fixture values must be text')
  if (node.type === 'string' || node.type === undefined) {
    try {
      const decoded: unknown = JSON.parse(node.value)
      return typeof decoded === 'string' ? decoded : node.value
    } catch {
      return node.value
    }
  }
  const decoded: unknown = JSON.parse(node.value)
  if (
    (node.type === 'number' && typeof decoded === 'number') ||
    (node.type === 'boolean' && typeof decoded === 'boolean') ||
    (node.type === 'array' && Array.isArray(decoded)) ||
    (node.type === 'object' && isRecordLike(decoded))
  )
    return decoded
  throw new Error(`Output fixture value does not match ${String(node.type)}`)
}

/** Restores typed output data from the documentation tree without its presentation flags. */
export function decodeOutputValues(nodes: unknown): Record<string, unknown> {
  if (!Array.isArray(nodes)) throw new Error('Output fixture must contain a list of fields')
  return Object.fromEntries(
    nodes.map((value) => {
      const node = toRecord(value)
      if (typeof node.key !== 'string') throw new Error('Output fixture field needs a key')
      return [node.key, decodeNode(node)]
    })
  )
}
