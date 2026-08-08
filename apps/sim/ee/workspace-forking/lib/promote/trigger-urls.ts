import type { ForkTargetWebhook } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import type { ForkPromotePlanItem } from '@/ee/workspace-forking/lib/promote/promote-plan'
import type { ForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { blockAdvertisesWebhookUrl, resolveBlockTriggerProvider } from '@/triggers/webhook-url'

/**
 * A public trigger URL a sync stops serving in the target.
 *
 * Only URLs that genuinely go away are reported: one an arriving trigger adopts keeps serving the
 * same path, so it is not a change. Whatever calls this path externally - a Slack Request URL, a
 * provider subscription - stops being called and has to be repointed by hand.
 */
export interface ForkTriggerUrlChange {
  workflowName: string
  path: string
}

/**
 * One arriving trigger block whose public URL this sync decides.
 *
 * A target webhook's path is `triggerPath || block.id`, and a sync assigns target block ids from
 * the SOURCE's block identity - so a trigger re-created in the source re-keys its target block and
 * moves the URL. `ownPath` is the stable case (the block already serves a URL, which is pinned
 * back verbatim); `adoptablePaths` is the decision, listing URLs retiring in the SAME target
 * workflow that this block can take over instead of minting a new one.
 */
export interface ForkTriggerSlot {
  sourceBlockId: string
  targetBlockId: string
  blockName: string
  workflowName: string
  /** The path this block already serves. Pinned as-is; there is no decision to make. */
  ownPath: string | null
  /** Retiring paths in the same target workflow this block could take over instead. */
  adoptablePaths: string[]
  /** The unambiguous pairing (exactly one retiring URL, exactly one arriving trigger). */
  defaultAdoptPath: string | null
}

/** Every trigger decision a sync makes, plus the URLs it would retire. */
export interface ForkTriggerPlan {
  slots: ForkTriggerSlot[]
  /** Live target webhooks on blocks this sync will not write - their URLs stop being served. */
  retiring: Array<{ path: string; workflowName: string }>
}

/** A caller's explicit choice of which retiring URL an arriving trigger takes over. */
export interface ForkTriggerMappingInput {
  sourceBlockId: string
  /** A path from that slot's `adoptablePaths`, or null to mint a new URL. */
  adoptPath: string | null
}

/**
 * Work out, per target workflow, which trigger URLs retire and which arriving triggers could
 * take them over.
 *
 * Adoption is deliberately scoped to a SINGLE target workflow. `webhook_path_claim` ownership is
 * per-workflow (`claimWebhookPath` conflicts only against a *different* workflow), so moving a
 * path between blocks of the same workflow re-uses a claim that workflow already holds and can
 * never conflict. Offering a path from another workflow would be a genuine ownership transfer,
 * which the claim layer refuses by design - so it is never a candidate.
 *
 * Pure over the pre-read source states, so the preview and the write agree by construction.
 */
export function buildForkTriggerPlan(params: {
  items: ForkPromotePlanItem[]
  sourceStates: Map<string, WorkflowState>
  resolveBlockId: ForkBlockIdResolver
  targetWebhooks: ReadonlyMap<string, ForkTargetWebhook>
}): ForkTriggerPlan {
  const { items, sourceStates, resolveBlockId, targetWebhooks } = params

  const liveByWorkflow = new Map<
    string,
    Array<{ blockId: string; path: string; provider: string | null }>
  >()
  for (const [blockId, row] of targetWebhooks) {
    const entry = { blockId, path: row.path, provider: row.provider }
    const list = liveByWorkflow.get(row.workflowId)
    if (list) list.push(entry)
    else liveByWorkflow.set(row.workflowId, [entry])
  }

  const slots: ForkTriggerSlot[] = []
  const retiring: ForkTriggerPlan['retiring'] = []

  for (const item of items) {
    const sourceState = sourceStates.get(item.sourceWorkflowId)
    if (!sourceState) continue

    const sourceByTargetBlockId = new Map<string, { sourceBlockId: string; block: BlockState }>()
    for (const [sourceBlockId, block] of Object.entries(sourceState.blocks)) {
      sourceByTargetBlockId.set(resolveBlockId(item.targetWorkflowId, sourceBlockId), {
        sourceBlockId,
        block,
      })
    }

    // A live webhook on a block this sync will not write: its URL stops being served.
    const live = liveByWorkflow.get(item.targetWorkflowId) ?? []
    const retired = live.filter((row) => !sourceByTargetBlockId.has(row.blockId))
    for (const row of retired) {
      retiring.push({ path: row.path, workflowName: item.sourceMeta.name })
    }

    const arriving: ForkTriggerSlot[] = []
    for (const [targetBlockId, { sourceBlockId, block }] of sourceByTargetBlockId) {
      // Only a block that advertises a public URL can hold one. Handing a retiring URL to a
      // poller or a shared-app trigger would point an external caller at a path its provider
      // never serves - so those are not candidates, and never appear as rows.
      if (!blockAdvertisesWebhookUrl(block)) continue
      const ownPath = targetWebhooks.get(targetBlockId)?.path ?? null
      // Only a retiring URL of the SAME provider is adoptable. A path is authenticated and parsed
      // as its provider, so handing a GitHub URL to a Slack trigger would keep the endpoint alive
      // while every request failed signature verification - and the sync would have reported the
      // URL as preserved, so nobody would go looking.
      const provider = resolveBlockTriggerProvider(block)
      arriving.push({
        sourceBlockId,
        targetBlockId,
        blockName: block.name,
        workflowName: item.sourceMeta.name,
        ownPath,
        // A block already serving a URL keeps it; only a block without one is a candidate to
        // adopt, so offering it a second URL would just be a way to break the first.
        adoptablePaths:
          ownPath === null && provider !== null
            ? retired.filter((row) => row.provider === provider).map((row) => row.path)
            : [],
        defaultAdoptPath: null,
      })
    }

    // Default only the unambiguous pairing, and only within one provider: with several retiring or
    // several arriving, guessing which new trigger replaces which old URL would silently point an
    // external caller at the wrong workflow branch - the user picks instead.
    const adopters = arriving.filter((slot) => slot.adoptablePaths.length > 0)
    if (adopters.length === 1 && adopters[0].adoptablePaths.length === 1) {
      adopters[0].defaultAdoptPath = adopters[0].adoptablePaths[0]
    }
    slots.push(...arriving)
  }

  return { slots, retiring }
}

/**
 * Resolve every trigger block's final path, applying the caller's explicit choices over the
 * plan's defaults, and report the URLs that still retire.
 *
 * An override is honoured only for a path the slot actually offered (same target workflow, still
 * retiring), and each path can be adopted once - so a crafted payload can neither move a URL
 * across workflows nor point two triggers at one path (which the unique webhook path index would
 * reject at deploy time anyway, failing the whole sync).
 */
export function resolveForkTriggerPaths(
  plan: ForkTriggerPlan,
  overrides: readonly ForkTriggerMappingInput[] = []
): {
  /** Target block id -> the path to pin into its `triggerPath`. */
  pathByTargetBlockId: Map<string, string>
  changes: ForkTriggerUrlChange[]
} {
  const overrideBySourceBlockId = new Map(
    overrides.map((entry) => [entry.sourceBlockId, entry.adoptPath])
  )

  const pathByTargetBlockId = new Map<string, string>()
  const adopted = new Set<string>()

  for (const slot of plan.slots) {
    if (slot.ownPath !== null) {
      pathByTargetBlockId.set(slot.targetBlockId, slot.ownPath)
      continue
    }
    const requested = overrideBySourceBlockId.has(slot.sourceBlockId)
      ? overrideBySourceBlockId.get(slot.sourceBlockId)!
      : slot.defaultAdoptPath
    if (requested === null || requested === undefined) continue
    if (!slot.adoptablePaths.includes(requested)) continue
    if (adopted.has(requested)) continue
    adopted.add(requested)
    pathByTargetBlockId.set(slot.targetBlockId, requested)
  }

  const changes: ForkTriggerUrlChange[] = []
  for (const row of plan.retiring) {
    // An adopted path keeps serving the same URL, so it is not a change to warn about.
    if (adopted.has(row.path)) continue
    changes.push({ workflowName: row.workflowName, path: row.path })
  }
  return { pathByTargetBlockId, changes }
}
