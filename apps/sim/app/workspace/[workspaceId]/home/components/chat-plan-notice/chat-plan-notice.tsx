'use client'

import { CHAT_PLAN_REQUIRED_UPGRADE } from '@/lib/billing/chat-plan'
import { PlanUsageLimitDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useChatPlanRequired } from '@/app/workspace/[workspaceId]/home/hooks/use-chat-plan-required'

/**
 * The upgrade card above the composer while the workspace's plan does not include Chat, the same
 * card run admission writes, so a free payer learns why Chat is held before sending. Render it
 * beside every `UserInput`, which disables send on the same verdict.
 */
export function ChatPlanNotice() {
  const chatPlanRequired = useChatPlanRequired()
  if (!chatPlanRequired) return null

  return (
    <div className='mx-auto mb-2 w-full max-w-chat'>
      <PlanUsageLimitDisplay data={CHAT_PLAN_REQUIRED_UPGRADE} />
    </div>
  )
}
