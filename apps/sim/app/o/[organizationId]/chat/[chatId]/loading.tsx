import { MothershipChatSkeleton } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/components/mothership-chat-skeleton'

/** Keep the transcript shape while the saved conversation is loading. */
export default function OrganizationChatLoading() {
  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <div className='mt-[var(--workspace-content-title-bar-inset)] min-h-0 flex-1 overflow-hidden px-6 pt-4 [scrollbar-gutter:stable_both-edges]'>
        <MothershipChatSkeleton />
      </div>
    </div>
  )
}
