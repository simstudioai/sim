import { ConversationSkeleton } from '@/platform/app/(shell)/_components/conversation/skeletons'

/** Keeps Search's landing boundary from standing in for a saved conversation. */
export default function OrganizationSearchChatLoading() {
  return <ConversationSkeleton header={null} />
}
