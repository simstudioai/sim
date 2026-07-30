import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { RedactedBlock } from '@/lib/workflows/api-reference/types'
import { getBlock } from '@/blocks'

/**
 * The ONLY subblock types whose stored value is exposed by block introspection.
 * This is an allowlist, never a denylist: a new subblock type is invisible until
 * someone deliberately adds it here. Every member is a pure structural selector —
 * an enum, toggle, slider, or routing choice — that reveals *which* operation ran,
 * never a secret. Everything else (free-text `short-input`/`long-input`, `code`,
 * `oauth-input` credentials, `messages-input` prompts, every resource `*-selector`,
 * `table`, `webhook-config`, …) is dropped, so credentials, secrets, env-var values,
 * and prompt/system content can never leak through this surface.
 */
const SAFE_SUBBLOCK_TYPES: ReadonlySet<SubBlockType> = new Set<SubBlockType>([
  'dropdown',
  'combobox',
  'slider',
  'switch',
  'checkbox-list',
  'grouped-checkbox-list',
  'time-input',
  'router-input',
])

/** A primitive or a shallow array of primitives — nothing that can nest a secret. */
function isSafeValue(value: unknown): boolean {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (Array.isArray(value)) {
    return value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
  }
  return false
}

interface RawBlock {
  type?: unknown
  name?: unknown
  subBlocks?: Record<string, { value?: unknown }>
}

interface RawEdge {
  source?: unknown
  target?: unknown
}

/**
 * Maps a block id -> the ids of the blocks it feeds, from the deployed edges. Wiring
 * is structural (never sensitive), so it is always safe to expose and is what lets a
 * caller reason "the call died between FetchProfile and Summarize".
 */
function buildOutgoingMap(edges: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!Array.isArray(edges)) return map
  for (const edge of edges as RawEdge[]) {
    if (typeof edge?.source !== 'string' || typeof edge?.target !== 'string') continue
    const list = map.get(edge.source) ?? []
    list.push(edge.target)
    map.set(edge.source, list)
  }
  return map
}

/**
 * Redacts a single deployed block to its safe projection: identity, type, name,
 * outgoing wiring, and only the allowlisted selector subblock values. The subblock's
 * *type* is resolved from the block registry (the stored deployed state carries only
 * values), so an unrecognized/custom block simply exposes no config — fail closed.
 */
function redactBlock(
  blockId: string,
  block: RawBlock,
  outgoing: Map<string, string[]>
): RedactedBlock {
  const type = typeof block.type === 'string' ? block.type : 'unknown'
  const name = typeof block.name === 'string' ? block.name : blockId

  const config: Record<string, unknown> = {}
  const blockConfig = getBlock(type)
  const storedSubBlocks = block.subBlocks ?? {}
  if (blockConfig) {
    for (const subBlockDef of blockConfig.subBlocks) {
      if (!SAFE_SUBBLOCK_TYPES.has(subBlockDef.type)) continue
      const stored = storedSubBlocks[subBlockDef.id]
      if (!stored || stored.value === undefined || stored.value === null) continue
      if (!isSafeValue(stored.value)) continue
      config[subBlockDef.id] = stored.value
    }
  }

  return {
    id: blockId,
    type,
    name,
    outgoing: outgoing.get(blockId) ?? [],
    config,
  }
}

/** All deployed blocks, redacted. Order-stable by block id for deterministic output. */
export function redactBlocks(
  blocks: Record<string, unknown> | null | undefined,
  edges: unknown
): RedactedBlock[] {
  if (!blocks) return []
  const outgoing = buildOutgoingMap(edges)
  return Object.keys(blocks)
    .sort()
    .map((blockId) => redactBlock(blockId, blocks[blockId] as RawBlock, outgoing))
}

/** A single deployed block, redacted, or null when the block id is not in the deployment. */
export function redactSingleBlock(
  blocks: Record<string, unknown> | null | undefined,
  edges: unknown,
  blockId: string
): RedactedBlock | null {
  if (!blocks || !(blockId in blocks)) return null
  const outgoing = buildOutgoingMap(edges)
  return redactBlock(blockId, blocks[blockId] as RawBlock, outgoing)
}
