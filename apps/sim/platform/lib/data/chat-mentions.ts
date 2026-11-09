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
  type MentionRequest,
  useMentionsFollowMutations,
  useOrganizationMentionPages,
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

const FAMILY_BY_GROUP = new Map(
  Object.entries(GROUPS).map(([family, group]) => [group, family as MentionFamily])
)

/** Whether the `/` list has landed, which a message naming a `/skill` waits for. */
export type SkillListStatus = 'pending' | 'landed' | 'failed'

/** Mention rows as the pickers list them, in groups by family. */
export function grouped(rows: readonly MentionRow[] | undefined) {
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
 * The resource menu's reads: the organization's workspaces, each workspace opened in the menu with
 * its families' first pages, a family's later pages as the menu asks for them, and the menu's own
 * search, which the server answers. Nothing is read while `enabled` is false.
 */
export function useMentionBrowse(enabled: boolean, organizationId: string) {
  const [browseSearch, setBrowseSearch] = useState('')
  const browseQuery = useSearchFilterValue(browseSearch, SEARCH_DEBOUNCE_MS).trim()
  const [openedWorkspaces, setOpenedWorkspaces] = useState<readonly string[]>([])
  /** Each browsed family's later pages, by `workspaceId:family`, as the cursors that read them. */
  const [laterPages, setLaterPages] = useState<Readonly<Record<string, readonly string[]>>>({})
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
  const browsed = useOrganizationMentionPages(
    organizationId,
    enabled
      ? openedWorkspaces.map((workspaceId) => ({
          query: '',
          workspaceId,
          limit: MENTION_BROWSE_LIMIT,
        }))
      : []
  )
  const pageRequests: (MentionRequest & { key: string })[] = enabled
    ? Object.entries(laterPages).flatMap(([key, cursors]) => {
        const [workspaceId, family] = key.split(':') as [string, MentionFamily]
        return cursors.map((cursor) => ({
          key,
          query: '',
          workspaceId,
          family,
          cursor,
          limit: MENTION_BROWSE_LIMIT,
        }))
      })
    : []
  const pages = useOrganizationMentionPages(
    organizationId,
    pageRequests.map(({ key: _key, ...request }) => request)
  )
  /** The cursor of a browsed family's next unread page, once the page before it has arrived. */
  function nextCursor(workspaceId: string, family: MentionFamily): string | undefined {
    const key = `${workspaceId}:${family}`
    const read = pageRequests.flatMap((request, index) =>
      request.key === key ? [pages[index]] : []
    )
    if (read.length) return read[read.length - 1]?.data?.nextCursor
    const opened = browsed[openedWorkspaces.indexOf(workspaceId)]
    return opened?.data?.families?.find((entry) => entry.family === family)?.nextCursor
  }
  return {
    /** Whether the rows are the search's matches rather than the browsed tree. */
    searching: Boolean(browseSearch.trim()),
    rows: browseSearch.trim()
      ? (browseMatches.data?.rows ?? [])
      : [
          ...(workspaces.data?.rows ?? []),
          ...browsed.flatMap((read) => read.data?.rows ?? []),
          ...pages.flatMap((read) => read.data?.rows ?? []),
        ],
    browseMore: (workspaceId: string, group: string) => {
      const family = FAMILY_BY_GROUP.get(group)
      const cursor = family && nextCursor(workspaceId, family)
      if (!family || !cursor) return undefined
      const key = `${workspaceId}:${family}`
      return () =>
        setLaterPages((current) =>
          current[key]?.includes(cursor)
            ? current
            : { ...current, [key]: [...(current[key] ?? []), cursor] }
        )
    },
    onBrowseWorkspace: (workspaceId: string) =>
      setOpenedWorkspaces((current) =>
        current.includes(workspaceId) ? current : [...current, workspaceId]
      ),
    onBrowseSearch: setBrowseSearch,
    workspaceLoaded: (workspaceId: string) =>
      Boolean(browsed[openedWorkspaces.indexOf(workspaceId)]?.data),
  }
}

/** Which of the composer's inventories the viewer has asked for so far. */
interface MentionInventoryWanted {
  /** The `@` matches and the resource menu, read once the viewer reaches for a resource. */
  resources: boolean
  /** Every skill for `/`, read once the draft holds a `/` token or a resource is reached for. */
  skills: boolean
}

/**
 * What the composer can mention across the viewer's workspaces in this organization, from one
 * server read per question: the `@` query's matches (the most recent rows when empty), every
 * skill for `/`, and the resource menu's workspaces, each opened workspace's families, or the
 * menu's own search. Each is read only once `wanted` asks for it, so a `/` alone reads no
 * resource list.
 */
export function useMentionInventory(
  wanted: MentionInventoryWanted,
  organizationId: string,
  search: string
) {
  const query = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()
  useMentionsFollowMutations()
  const suggestions = useOrganizationMentions(
    organizationId,
    { query, limit: MENTION_SUGGESTION_LIMIT },
    { enabled: wanted.resources }
  )
  const skills = useOrganizationMentions(
    organizationId,
    { query: '', family: 'skills', limit: MENTION_BROWSE_LIMIT },
    { enabled: wanted.skills }
  )
  const { rows, browseMore, onBrowseWorkspace, onBrowseSearch } = useMentionBrowse(
    wanted.resources,
    organizationId
  )
  const skillList: SkillListStatus = skills.data ? 'landed' : skills.isError ? 'failed' : 'pending'
  return {
    references: grouped(suggestions.data?.rows),
    referencesLoading:
      wanted.resources &&
      (suggestions.isPending || search.trim() !== query || suggestions.isFetching),
    skills: grouped(skills.data?.rows).flatMap(({ items }) => items),
    skillsLoading: wanted.skills && skills.isPending,
    skillList,
    browse: grouped(rows),
    browseMore,
    onBrowseWorkspace,
    onBrowseSearch,
  }
}
