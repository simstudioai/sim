'use client'

import { lazy, type ReactNode, Suspense, useCallback, useState } from 'react'
import { formatTimestamp } from '@/platform/shared/time'
import type { ChatContext } from '@/stores/panel'

/** The lists' queries load only once a picker first opens. */
const WorkspaceReader = lazy(() =>
  import('@/platform/lib/data/chat-reference-reader').then((module) => ({
    default: module.WorkspaceReader,
  }))
)

/** How many workspaces read their lists at once; the next starts as each settles. */
const READ_CONCURRENCY = 8

interface NamedRecord {
  id: string
  name: string
}

export interface WorkspaceLists {
  tables?: readonly NamedRecord[]
  files?: readonly NamedRecord[]
  /** The query the files are the server's matches for, or empty for the recent files. */
  fileQuery: string
  knowledgeBases?: readonly NamedRecord[]
  chats?: readonly NamedRecord[]
  logs?: readonly {
    id: string
    executionId: string | null
    workflowId: string | null
    createdAt: string
    workflow: { name?: string | null } | null
  }[]
  /** Workflow, table and knowledge base folders, each named by its family. */
  folders: readonly (NamedRecord & { family: string })[]
  fileFolders?: readonly NamedRecord[]
  dashboards: readonly NamedRecord[]
  pending: boolean
}

function workspaceGroups(
  workspaces: readonly NamedRecord[],
  lists: Readonly<Record<string, WorkspaceLists>>
) {
  const owned = <T,>(read: (lists: WorkspaceLists) => readonly T[] | undefined) =>
    workspaces.flatMap((workspace) =>
      (lists[workspace.id] ? (read(lists[workspace.id]) ?? []) : []).map((record) => ({
        record,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      }))
    )
  const item = (
    workspaceId: string,
    workspaceName: string,
    id: string,
    name: string,
    context: ChatContext
  ) => ({ id: `${workspaceId}:${id}`, name, workspaceId, workspaceName, context })
  return [
    {
      group: 'Chats',
      items: owned((list) => list.chats).map(({ record, workspaceId, workspaceName }) =>
        item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'past_chat',
          chatId: record.id,
          label: record.name,
          workspaceId,
        })
      ),
    },
    {
      group: 'Tables',
      items: owned((list) => list.tables).map(({ record, workspaceId, workspaceName }) =>
        item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'table',
          tableId: record.id,
          label: record.name,
          workspaceId,
        })
      ),
    },
    {
      group: 'Files',
      items: workspaces.flatMap((workspace) => {
        const list = lists[workspace.id]
        return (list?.files ?? []).map((file) => ({
          ...item(workspace.id, workspace.name, file.id, file.name, {
            kind: 'file',
            fileId: file.id,
            label: file.name,
            workspaceId: workspace.id,
          }),
          ...(list?.fileQuery ? { matchedQuery: list.fileQuery } : {}),
        }))
      }),
    },
    {
      group: 'Knowledge Bases',
      items: owned((list) => list.knowledgeBases).map(({ record, workspaceId, workspaceName }) =>
        item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'knowledge',
          knowledgeId: record.id,
          label: record.name,
          workspaceId,
        })
      ),
    },
    {
      group: 'Dashboards',
      items: owned((list) => list.dashboards).map(({ record, workspaceId, workspaceName }) =>
        item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'dashboard',
          dashboardId: record.id,
          label: record.name,
          workspaceId,
        })
      ),
    },
    {
      group: 'File Folders',
      items: owned((list) => list.fileFolders).map(({ record, workspaceId, workspaceName }) =>
        item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'filefolder',
          fileFolderId: record.id,
          label: record.name,
          workspaceId,
        })
      ),
    },
    {
      group: 'Folders',
      items: owned((list) => list.folders).map(({ record, workspaceId, workspaceName }) => ({
        ...item(workspaceId, workspaceName, record.id, record.name, {
          kind: 'folder',
          folderId: record.id,
          label: record.name,
          workspaceId,
        }),
        family: record.family,
      })),
    },
    {
      group: 'Logs',
      items: owned((list) => list.logs).map(({ record, workspaceId, workspaceName }) => {
        // The name keeps the absolute time: it is saved with the chat, where an age goes stale.
        const name = `${record.workflow?.name ?? record.workflowId ?? 'Unknown'} · ${formatTimestamp(Date.parse(record.createdAt))}`
        const executionId = record.executionId ?? record.id
        return {
          ...item(workspaceId, workspaceName, executionId, name, {
            kind: 'logs',
            executionId,
            label: name,
            workspaceId,
          }),
          family: 'Logs',
        }
      }),
    },
  ]
}

/**
 * The chats, dashboards, tables, files, folders, knowledge bases and logs of each workspace, for
 * `@` mentions. Each
 * workspace's lists are separate queries, so a renderless reader per workspace runs them; the
 * composer mounts `readers` while the inventory is wanted.
 */
export function useWorkspaceReferences(
  workspaces: readonly NamedRecord[],
  fileSearch: string
): { references: ReturnType<typeof workspaceGroups>; loading: boolean; readers: ReactNode } {
  const [lists, setLists] = useState<Record<string, WorkspaceLists>>({})
  const onRead = useCallback((workspaceId: string, next: WorkspaceLists) => {
    setLists((current) =>
      current[workspaceId] === next ? current : { ...current, [workspaceId]: next }
    )
  }, [])
  const settled = workspaces.filter((workspace) => lists[workspace.id]?.pending === false).length
  const [readable, setReadable] = useState(0)
  if (workspaces.length && settled + READ_CONCURRENCY > readable)
    setReadable(settled + READ_CONCURRENCY)
  return {
    references: workspaceGroups(workspaces, lists),
    loading: workspaces.some((workspace) => lists[workspace.id]?.pending !== false),
    readers: readable ? (
      <Suspense fallback={null}>
        {workspaces.slice(0, readable).map((workspace) => (
          <WorkspaceReader
            key={workspace.id}
            workspaceId={workspace.id}
            fileSearch={fileSearch}
            onRead={onRead}
          />
        ))}
      </Suspense>
    ) : null,
  }
}
