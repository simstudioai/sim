'use client'

import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'
import { RESOURCE_LIST_CHROME } from '@/app/workspace/[workspaceId]/components/resource/list-chrome'

export default function KnowledgeLoading() {
  return <ResourceChromeFallback {...RESOURCE_LIST_CHROME.knowledge} />
}
