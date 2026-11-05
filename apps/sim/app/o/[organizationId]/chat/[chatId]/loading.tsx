import { ConversationSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'

/** Keep the transcript shape while the saved conversation is loading. */
export default function OrganizationChatLoading() {
  return <ConversationSkeleton />
}
