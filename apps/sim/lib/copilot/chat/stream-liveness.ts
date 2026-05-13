import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { getChatStreamLockOwners } from '@/lib/copilot/request/session'

const logger = createLogger('ChatStreamLiveness')

export interface ChatStreamMarkerCandidate {
  chatId: string
  streamId: string | null
}

export interface ReconciledChatStreamMarker {
  chatId: string
  streamId: string | null
  status: 'active' | 'inactive' | 'unknown'
}

interface ReconcileChatStreamMarkersOptions {
  repairVerifiedStaleMarkers?: boolean
}

/**
 * Reconciles persisted chat stream markers against the runtime stream lock.
 *
 * Redis lock ownership is the canonical live-stream signal. When the lookup is
 * verified, missing owners clear stale persisted markers and present owners win
 * over stale DB values. When Redis state is unknown, persisted markers are
 * preserved so a transient Redis failure in a multi-pod deployment does not
 * incorrectly hide a live stream owned by another pod.
 */
export async function reconcileChatStreamMarkers(
  candidates: ChatStreamMarkerCandidate[],
  options: ReconcileChatStreamMarkersOptions = {}
): Promise<Map<string, ReconciledChatStreamMarker>> {
  const results = new Map<string, ReconciledChatStreamMarker>()

  for (const candidate of candidates) {
    if (candidate.streamId === null) {
      results.set(candidate.chatId, {
        chatId: candidate.chatId,
        streamId: null,
        status: 'inactive',
      })
      continue
    }
    results.set(candidate.chatId, {
      chatId: candidate.chatId,
      streamId: candidate.streamId,
      status: 'unknown',
    })
  }

  const candidatesWithMarkers = candidates.filter((candidate) => candidate.streamId !== null)
  if (candidatesWithMarkers.length === 0) {
    return results
  }

  const { status, ownersByChatId } = await getChatStreamLockOwners(
    candidatesWithMarkers.map((candidate) => candidate.chatId)
  )

  for (const candidate of candidatesWithMarkers) {
    const owner = ownersByChatId.get(candidate.chatId)
    if (owner && (status === 'verified' || owner === candidate.streamId)) {
      results.set(candidate.chatId, {
        chatId: candidate.chatId,
        streamId: owner,
        status: 'active',
      })
      continue
    }

    if (status === 'verified') {
      results.set(candidate.chatId, {
        chatId: candidate.chatId,
        streamId: null,
        status: 'inactive',
      })
      continue
    }

    results.set(candidate.chatId, {
      chatId: candidate.chatId,
      streamId: candidate.streamId,
      status: 'unknown',
    })
  }

  if (options.repairVerifiedStaleMarkers) {
    await repairVerifiedStaleMarkers(candidates, results)
  }

  return results
}

async function repairVerifiedStaleMarkers(
  candidates: ChatStreamMarkerCandidate[],
  results: Map<string, ReconciledChatStreamMarker>
): Promise<void> {
  const staleCandidates = candidates.filter(
    (candidate): candidate is { chatId: string; streamId: string } => {
      const result = results.get(candidate.chatId)
      return (
        candidate.streamId !== null && result?.status === 'inactive' && result.streamId === null
      )
    }
  )

  if (staleCandidates.length === 0) return

  await Promise.all(
    staleCandidates.map(async (candidate) => {
      try {
        await db
          .update(copilotChats)
          .set({ conversationId: null })
          .where(
            and(
              eq(copilotChats.id, candidate.chatId),
              eq(copilotChats.conversationId, candidate.streamId)
            )
          )
      } catch (error) {
        logger.warn('Failed to repair stale chat stream marker', {
          chatId: candidate.chatId,
          streamId: candidate.streamId,
          error: toError(error).message,
        })
      }
    })
  )
}
