import type { AgentPlanItem, StreamEvent, StreamingContext } from '@/lib/mothership/request/types'
import { ContentBlockType } from '@/lib/mothership/request/types'
import type { StreamHandler } from './types'
import { addContentBlock } from './types'

/**
 * The agent's visible plan: whole-list replacement semantics (the worker's
 * update_plan tool sends the complete list every call). One plan block per
 * message, updated in place so the checklist renders live instead of stacking
 * a card per update.
 */
export const handlePlanEvent: StreamHandler = (event: StreamEvent, context: StreamingContext) => {
  const items = (event.payload as { items?: AgentPlanItem[] } | undefined)?.items
  if (!Array.isArray(items) || items.length === 0) return

  for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
    const block = context.contentBlocks[i]
    if (block.type === ContentBlockType.plan) {
      block.planItems = items
      block.endedAt = Date.now()
      return
    }
  }
  addContentBlock(context, {
    type: ContentBlockType.plan,
    planItems: items,
  })
}
