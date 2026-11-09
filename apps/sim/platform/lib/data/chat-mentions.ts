'use client'

import { useState } from 'react'
import {
  MENTION_BROWSE_LIMIT,
  MENTION_SUGGESTION_LIMIT,
  type MentionFamily,
  type MentionRow,
} from '@/lib/api/contracts/organization-mentions'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  useOrganizationMentionBrowse,
  useOrganizationMentions,
} from '@/hooks/queries/organization-mentions'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import type { ChatContext } from '@/platform/lib/data/chat-types'
import { formatTimestamp } from '@/platform/shared/time'

/** The picker group each family lists under. */
const GROUPS: Record<MentionFamily, string> = {
  workspaces: 'Workspaces',
  chats: 'Chats',
  dashboards: 'Dashboards',
  tables: 'Tables',
  files: 'Files',
  file_folders: 'File Folders',
  knowledge_bases: 'Knowledge Bases',
  workflows: 'Workflows',
  logs: 'Logs',
  folders: 'Folders',
  skills: 'Skills',
}

/** A mention as the composer's picker lists it, with the context a pick attaches. */
interface MentionReference {
  id: string
  name: string
  context: ChatContext
  workspaceId?: string
  workspaceName?: string
  detail?: string
  family?: string
  matchedQuery?: string
}

function mentionReference(row: MentionRow): MentionReference {
  const owner = row.workspaceId
  const owned = (id: string, name: string) => ({
    id: owner ? `${owner}:${id}` : id,
    name,
    workspaceId: owner,
    workspaceName: row.workspaceName,
  })
  switch (row.family) {
    case 'workspaces':
      return {
        id: row.id,
        name: row.name,
        workspaceId: row.id,
        context: { kind: 'workspace', workspaceId: row.id, label: row.name },
      }
    case 'workflows':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'workflow', workflowId: row.id, label: row.name, workspaceId: owner },
      }
    case 'skills':
      return {
        ...owned(row.id, row.name),
        detail: row.detail,
        context: { kind: 'skill', skillId: row.id, label: row.name, workspaceId: owner },
      }
    case 'chats':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'past_chat', chatId: row.id, label: row.name, workspaceId: owner },
      }
    case 'tables':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'table', tableId: row.id, label: row.name, workspaceId: owner },
      }
    case 'files':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'file', fileId: row.id, label: row.name, workspaceId: owner },
        ...(row.matchedQuery ? { matchedQuery: row.matchedQuery } : {}),
      }
    case 'knowledge_bases':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'knowledge', knowledgeId: row.id, label: row.name, workspaceId: owner },
      }
    case 'dashboards':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'dashboard', dashboardId: row.id, label: row.name, workspaceId: owner },
      }
    case 'file_folders':
      return {
        ...owned(row.id, row.name),
        context: { kind: 'filefolder', fileFolderId: row.id, label: row.name, workspaceId: owner },
      }
    case 'folders':
      return {
        ...owned(row.id, row.name),
        family: row.folderFamily,
        context: { kind: 'folder', folderId: row.id, label: row.name, workspaceId: owner },
      }
    case 'logs': {
      // The name keeps the absolute time: it is saved with the chat, where an age goes stale.
      const name = `${row.workflowLabel ?? row.name} · ${formatTimestamp(Date.parse(row.createdAt ?? ''))}`
      const executionId = row.executionId ?? row.id
      return {
        ...owned(executionId, name),
        family: 'Logs',
        context: { kind: 'logs', executionId, label: name, workspaceId: owner },
      }
    }
  }
}

function grouped(rows: readonly MentionRow[] | undefined) {
  const groups = new Map<string, MentionReference[]>()
  for (const row of rows ?? []) {
    const group = GROUPS[row.family]
    const items = groups.get(group)
    const item = mentionReference(row)
    if (items) items.push(item)
    else groups.set(group, [item])
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}

/**
 * What the composer can mention across the viewer's workspaces in this organization, from one
 * server read per question: the `@` query's matches (the most recent rows when empty), every
 * skill for `/`, and the resource menu's workspaces, each opened workspace's families, or the
 * menu's own search. Nothing is read until a picker first opens.
 */
export function useMentionInventory(enabled: boolean, organizationId: string, search: string) {
  const query = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()
  const [browseSearch, setBrowseSearch] = useState('')
  const browseQuery = useSearchFilterValue(browseSearch, SEARCH_DEBOUNCE_MS).trim()
  const [openedWorkspaces, setOpenedWorkspaces] = useState<readonly string[]>([])
  const suggestions = useOrganizationMentions(
    organizationId,
    { query, limit: MENTION_SUGGESTION_LIMIT },
    { enabled }
  )
  const skills = useOrganizationMentions(
    organizationId,
    { query: '', family: 'skills', limit: MENTION_BROWSE_LIMIT },
    { enabled }
  )
  const workspaces = useOrganizationMentions(
    organizationId,
    { query: '', family: 'workspaces', limit: MENTION_BROWSE_LIMIT },
    { enabled }
  )
  const browseMatches = useOrganizationMentions(
    organizationId,
    { query: browseQuery, limit: MENTION_SUGGESTION_LIMIT },
    { enabled: enabled && Boolean(browseQuery) }
  )
  const browsed = useOrganizationMentionBrowse(
    organizationId,
    enabled ? openedWorkspaces : [],
    MENTION_BROWSE_LIMIT
  )
  return {
    references: grouped(suggestions.data?.rows),
    referencesLoading:
      enabled && (suggestions.isPending || search.trim() !== query || suggestions.isFetching),
    skills: grouped(skills.data?.rows).flatMap(({ items }) => items),
    skillsLoading: enabled && skills.isPending,
    browse: browseSearch.trim()
      ? grouped(browseMatches.data?.rows)
      : grouped([
          ...(workspaces.data?.rows ?? []),
          ...browsed.flatMap((read) => read.data?.rows ?? []),
        ]),
    onBrowseWorkspace: (workspaceId: string) =>
      setOpenedWorkspaces((current) =>
        current.includes(workspaceId) ? current : [...current, workspaceId]
      ),
    onBrowseSearch: setBrowseSearch,
  }
}
