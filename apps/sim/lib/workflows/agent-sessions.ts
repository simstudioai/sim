import { generateId } from '@sim/utils/id'

export interface AgentSessionBlockShape {
  id: string
  type: string
  name?: string
  subBlocks: Record<string, { value?: unknown }>
}

export type AgentSessionValueMap = Record<string, Record<string, unknown>>

export interface AgentSessionCatalogEntry {
  id: string
  label: string
  color: string
  blockIds: string[]
  blockNames: string[]
  sourceBlockId: string
  values: Record<string, unknown>
}

interface BuildAgentSessionCatalogOptions {
  blocks: Record<string, AgentSessionBlockShape>
  subBlockValues?: AgentSessionValueMap
  blockType: string
  sessionSubBlockId: string
  compatibleSubBlockIds?: readonly string[]
}

interface RemapCopiedAgentSessionsOptions {
  sourceBlocks: Record<string, AgentSessionBlockShape>
  copiedBlocks: Record<string, AgentSessionBlockShape>
  blockIdMap: ReadonlyMap<string, string>
  sourceSubBlockValues?: AgentSessionValueMap
  copiedSubBlockValues: AgentSessionValueMap
  blockType?: string
  sessionSubBlockId?: string
  createId?: () => string
}

interface CopiedAgentMember {
  oldBlockId: string
  newBlockId: string
  rawAgentId: unknown
  logicalAgentId: string
}

const AGENT_SESSION_COLORS = [
  '#6366f1',
  '#0284c7',
  '#0f766e',
  '#b45309',
  '#c2410c',
  '#be185d',
  '#7e22ce',
  '#15803d',
] as const

/** Reads the live value first while preserving the workflow store's explicit-null semantics. */
export function readAgentSessionSubBlockValue(
  block: AgentSessionBlockShape,
  values: Record<string, unknown> | undefined,
  subBlockId: string
): unknown {
  if (values && Object.hasOwn(values, subBlockId) && values[subBlockId] !== undefined) {
    return values[subBlockId]
  }
  return block.subBlocks[subBlockId]?.value
}

/** Blank IDs deliberately resolve to the block ID, matching the executor contract. */
export function resolveAgentSessionId(blockId: string, value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : blockId
}

/** A stable color derived from the logical ID, so every reference to one agent matches. */
export function getAgentSessionColor(agentId: string): string {
  let hash = 0
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) | 0
  }
  return AGENT_SESSION_COLORS[Math.abs(hash) % AGENT_SESSION_COLORS.length]
}

/** Builds the authoring-only catalog of logical agents used by one block type. */
export function buildAgentSessionCatalog({
  blocks,
  subBlockValues = {},
  blockType,
  sessionSubBlockId,
  compatibleSubBlockIds = [],
}: BuildAgentSessionCatalogOptions): AgentSessionCatalogEntry[] {
  const sessions = new Map<string, Omit<AgentSessionCatalogEntry, 'label' | 'color'>>()

  for (const [blockId, block] of Object.entries(blocks)) {
    if (block.type !== blockType || !block.subBlocks[sessionSubBlockId]) continue

    const liveValues = subBlockValues[blockId]
    const agentId = resolveAgentSessionId(
      blockId,
      readAgentSessionSubBlockValue(block, liveValues, sessionSubBlockId)
    )
    const existing = sessions.get(agentId)
    if (existing) {
      existing.blockIds.push(blockId)
      existing.blockNames.push(block.name || blockId)
      continue
    }

    const values = Object.fromEntries(
      compatibleSubBlockIds.map((subBlockId) => [
        subBlockId,
        readAgentSessionSubBlockValue(block, liveValues, subBlockId),
      ])
    )
    sessions.set(agentId, {
      id: agentId,
      blockIds: [blockId],
      blockNames: [block.name || blockId],
      sourceBlockId: blockId,
      values,
    })
  }

  return Array.from(sessions.values()).map((session, index) => ({
    ...session,
    label: `Agent ${index + 1}`,
    color: AGENT_SESSION_COLORS[index % AGENT_SESSION_COLORS.length],
  }))
}

function writeCopiedAgentId(
  copiedBlocks: Record<string, AgentSessionBlockShape>,
  copiedSubBlockValues: AgentSessionValueMap,
  blockId: string,
  sessionSubBlockId: string,
  value: string
): void {
  const block = copiedBlocks[blockId]
  const subBlock = block?.subBlocks[sessionSubBlockId]
  if (!subBlock) return

  subBlock.value = value
  const values = copiedSubBlockValues[blockId] ?? {}
  values[sessionSubBlockId] = value
  copiedSubBlockValues[blockId] = values
}

/**
 * Gives pasted/duplicated agents a fresh identity while retaining sharing only
 * among members copied together. A copied default agent can keep its blank
 * value because its new block ID already supplies a fresh logical identity.
 */
export function remapCopiedAgentSessions({
  sourceBlocks,
  copiedBlocks,
  blockIdMap,
  sourceSubBlockValues = {},
  copiedSubBlockValues,
  blockType = 'codex',
  sessionSubBlockId = 'agentId',
  createId = generateId,
}: RemapCopiedAgentSessionsOptions): void {
  const groups = new Map<string, CopiedAgentMember[]>()

  for (const [oldBlockId, sourceBlock] of Object.entries(sourceBlocks)) {
    const newBlockId = blockIdMap.get(oldBlockId)
    if (
      !newBlockId ||
      sourceBlock.type !== blockType ||
      !sourceBlock.subBlocks[sessionSubBlockId] ||
      !copiedBlocks[newBlockId]?.subBlocks[sessionSubBlockId]
    ) {
      continue
    }

    const rawAgentId = readAgentSessionSubBlockValue(
      sourceBlock,
      sourceSubBlockValues[oldBlockId],
      sessionSubBlockId
    )
    const logicalAgentId = resolveAgentSessionId(oldBlockId, rawAgentId)
    const members = groups.get(logicalAgentId) ?? []
    members.push({ oldBlockId, newBlockId, rawAgentId, logicalAgentId })
    groups.set(logicalAgentId, members)
  }

  for (const members of groups.values()) {
    const defaultOwner = members.find(
      (member) =>
        member.logicalAgentId === member.oldBlockId &&
        !(typeof member.rawAgentId === 'string' && member.rawAgentId.trim())
    )
    const targetAgentId = defaultOwner?.newBlockId ?? createId()

    for (const member of members) {
      // The copied default owner already resolves to targetAgentId via its new block ID.
      if (defaultOwner?.oldBlockId === member.oldBlockId) continue
      writeCopiedAgentId(
        copiedBlocks,
        copiedSubBlockValues,
        member.newBlockId,
        sessionSubBlockId,
        targetAgentId
      )
    }
  }
}
