import type { Awareness } from 'y-protocols/awareness'

/**
 * Awareness field a collaborative client sets on its OWN state while it is applying an agent stream into
 * the shared doc. Read by every peer to run the single-writer election below. Coexists with the caret
 * `user` field (`setLocalStateField` writes one field without clobbering others).
 */
const AGENT_APPLYING_FIELD = 'agentApplying'

/** Announce that this client is applying an agent stream (candidate in the leader election). */
export function announceAgentApplying(awareness: Awareness): void {
  awareness.setLocalStateField(AGENT_APPLYING_FIELD, true)
}

/** Stop announcing (this client is no longer applying an agent stream). */
export function clearAgentApplying(awareness: Awareness): void {
  awareness.setLocalStateField(AGENT_APPLYING_FIELD, null)
}

/**
 * Single-writer election: exactly one collaborative client applies a given agent stream into the shared
 * doc, so N tabs/windows watching the same live copilot stream don't each insert it under a different
 * Yjs clientID and duplicate the content. The leader is the MINIMUM clientID among all clients currently
 * announcing (via {@link announceAgentApplying}) that they are applying — a deterministic tie-break that
 * needs no coordinator. A brief startup race (before an announcement propagates to peers) is bounded to a
 * frame or two — self-corrected the moment awareness converges, and reconciled anyway by the durable
 * server write. In the common single-client case the caller is the only announcer, so it always leads.
 */
export function isAgentStreamLeader(awareness: Awareness, selfClientId: number): boolean {
  let leader = Number.POSITIVE_INFINITY
  awareness.getStates().forEach((state, clientId) => {
    if ((state as Record<string, unknown> | undefined)?.[AGENT_APPLYING_FIELD] === true) {
      leader = Math.min(leader, clientId)
    }
  })
  return leader === selfClientId
}
