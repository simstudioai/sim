import crypto from 'crypto'
import { db } from '@sim/db'
import { copilotWorkflowReadHashes } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'

type WorkflowStateLike = {
  blocks?: Record<string, unknown>
  edges?: unknown[]
  loops?: Record<string, unknown>
  parallels?: Record<string, unknown>
}

export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForHash)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalizeForHash(nested)])
    )
  }
  return value
}

export function hashCanonicalJson(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeForHash(value))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export function computeWorkflowReadHashFromSanitizedState(sanitizedState: unknown): string {
  return hashCanonicalJson(sanitizedState)
}

export function computeWorkflowReadHashFromWorkflowState(state: WorkflowStateLike): {
  sanitizedState: ReturnType<typeof sanitizeForCopilot>
  hash: string
} {
  const sanitizedState = sanitizeForCopilot({
    blocks: state.blocks || {},
    edges: state.edges || [],
    loops: state.loops || {},
    parallels: state.parallels || {},
  } as Parameters<typeof sanitizeForCopilot>[0])

  return {
    sanitizedState,
    hash: computeWorkflowReadHashFromSanitizedState(sanitizedState),
  }
}

export async function getWorkflowReadHash(
  chatId: string,
  workflowId: string
): Promise<string | null> {
  const [row] = await db
    .select({ hash: copilotWorkflowReadHashes.hash })
    .from(copilotWorkflowReadHashes)
    .where(
      and(
        eq(copilotWorkflowReadHashes.chatId, chatId),
        eq(copilotWorkflowReadHashes.workflowId, workflowId)
      )
    )
    .limit(1)

  return row?.hash ?? null
}

export async function upsertWorkflowReadHash(
  chatId: string,
  workflowId: string,
  hash: string
): Promise<void> {
  await db
    .insert(copilotWorkflowReadHashes)
    .values({
      chatId,
      workflowId,
      hash,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [copilotWorkflowReadHashes.chatId, copilotWorkflowReadHashes.workflowId],
      set: {
        hash,
        updatedAt: new Date(),
      },
    })
}

export async function upsertWorkflowReadHashForWorkflowState(
  chatId: string,
  workflowId: string,
  state: WorkflowStateLike
): Promise<{
  sanitizedState: ReturnType<typeof sanitizeForCopilot>
  hash: string
}> {
  const computed = computeWorkflowReadHashFromWorkflowState(state)
  await upsertWorkflowReadHash(chatId, workflowId, computed.hash)
  return computed
}

export async function upsertWorkflowReadHashForSanitizedState(
  chatId: string,
  workflowId: string,
  sanitizedState: unknown
): Promise<string> {
  const hash = computeWorkflowReadHashFromSanitizedState(sanitizedState)
  await upsertWorkflowReadHash(chatId, workflowId, hash)
  return hash
}
