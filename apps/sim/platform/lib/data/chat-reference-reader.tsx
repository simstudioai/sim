'use client'

import { useEffect, useMemo } from 'react'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { type LogFilters, useLogsList } from '@/hooks/queries/logs'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkspaceFilePickerOptions } from '@/hooks/queries/workspace-files'
import type { WorkspaceLists } from '@/platform/lib/data/chat-references'

/** How many of the most recently updated files a workspace offers before anything is typed. */
const RECENT_FILE_LIMIT = 100

const LOG_FILTERS: LogFilters = {
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
}

interface WorkspaceReaderProps {
  workspaceId: string
  fileSearch: string
  onRead: (workspaceId: string, lists: WorkspaceLists) => void
}

/** One workspace's mention lists, through the same queries and options legacy's inventory used. */
export function WorkspaceReader({ workspaceId, fileSearch, onRead }: WorkspaceReaderProps) {
  const tables = useTablesList(workspaceId, 'active')
  const files = useWorkspaceFilePickerOptions(workspaceId, fileSearch, {
    limit: RECENT_FILE_LIMIT,
  })
  const knowledgeBases = useKnowledgeBasesQuery(workspaceId)
  const chats = useMothershipChats(workspaceId)
  const logs = useLogsList(workspaceId, LOG_FILTERS)
  const pending =
    tables.isPending ||
    files.isPending ||
    knowledgeBases.isPending ||
    chats.isPending ||
    logs.isPending
  const lists = useMemo(
    (): WorkspaceLists => ({
      tables: tables.data,
      files: files.files,
      fileQuery: files.matchedQuery,
      knowledgeBases: knowledgeBases.data,
      chats: chats.data,
      logs: logs.data?.pages.flatMap((page) => page.logs),
      pending,
    }),
    [
      tables.data,
      files.files,
      files.matchedQuery,
      knowledgeBases.data,
      chats.data,
      logs.data,
      pending,
    ]
  )
  useEffect(() => {
    onRead(workspaceId, lists)
  }, [workspaceId, lists, onRead])
  return null
}
