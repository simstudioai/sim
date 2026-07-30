import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { isCustomBlocksEligible } from '@/lib/workflows/custom-blocks/operations'

const logger = createLogger('CopilotEntitlements')

/**
 * Cross-repo contract: the mothership (Go) matches these exact strings against
 * its `core.Entitlement*` constants to gate agent surfaces.
 */
export const CUSTOM_BLOCKS_ENTITLEMENT = 'custom-blocks'

/**
 * Workspace entitlements — plan/flag-gated org capabilities sent to the
 * mothership as the chat payload's `entitlements` array. The Go side hides the
 * matching tools, skills, and prompt sections when an entitlement is absent, so
 * a non-entitled org's agents never hear of the feature.
 *
 * Adding an entitlement:
 * 1. Add the kebab-case name and a fail-closed evaluator here. Every payload
 *    site (interactive chat, headless execute, inbox) picks it up automatically.
 * 2. Go repo: add the matching `Entitlement*` constant in `internal/core` and
 *    gate surfaces declaratively — `RequiredEntitlement` on tool definitions,
 *    `entitlement:` frontmatter on skills, a conditional section in
 *    `BuildAgentEnvelope`, or a variant swap in `Capabilities`.
 * 3. Keep enforcement in sim: the Go gating is advertisement-only (the payload
 *    is forgeable), so the sim-side tool handler must re-check the same
 *    predicate at execution time.
 */
const ENTITLEMENT_EVALUATORS: Record<
  string,
  (workspaceId: string, userId?: string) => Promise<boolean>
> = {
  [CUSTOM_BLOCKS_ENTITLEMENT]: isCustomBlocksEligible,
}

const entitlementsCache = new LRUCache<string, Promise<string[]>>({
  max: 500,
  ttl: 5_000,
})

/**
 * The entitlements to send to the mothership for a request in this workspace.
 * Each evaluator fails closed (an error means the entitlement is absent).
 * Cached briefly so the several per-message callers collapse to one evaluation.
 */
export function computeWorkspaceEntitlements(
  workspaceId: string,
  userId?: string
): Promise<string[]> {
  const cacheKey = `${workspaceId}:${userId ?? ''}`
  const cached = entitlementsCache.get(cacheKey)
  if (cached) return cached

  const promise = Promise.all(
    Object.entries(ENTITLEMENT_EVALUATORS).map(async ([name, evaluate]) => {
      try {
        return (await evaluate(workspaceId, userId)) ? name : null
      } catch (error) {
        logger.warn('Entitlement evaluation failed; treating as absent', {
          entitlement: name,
          workspaceId,
          error: getErrorMessage(error),
        })
        return null
      }
    })
  ).then((names) => names.filter((name): name is string => name !== null))
  entitlementsCache.set(cacheKey, promise)
  return promise
}
