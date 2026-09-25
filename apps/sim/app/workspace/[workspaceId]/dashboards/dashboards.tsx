'use client'

import { useState } from 'react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ChartColumn, Folder, Loader, MoreHorizontal, Pencil, Trash } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  DashboardDialog,
  type DashboardDialogState,
} from '@/app/workspace/[workspaceId]/dashboards/dashboard-dialog'
import { dashboardBrowserParsers } from '@/app/workspace/[workspaceId]/dashboards/search-params'
import { useWorkspaceFilesRoom } from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files-room'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useDashboardFolders, useDashboards } from '@/hooks/queries/dashboards'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'

interface DashboardsProps {
  workspaceId: string
}
interface DashboardRowActionsProps {
  label: string
  onEdit: () => void
  onDelete: () => void
}
const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 3 },
  { id: 'updated', header: 'Updated' },
  { id: 'actions', header: '', widthMultiplier: 0.3 },
]

function DashboardRowActions({ label, onEdit, onDelete }: DashboardRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip
          aria-label={`Actions for ${label}`}
          leftIcon={MoreHorizontal}
          onClick={(event) => event.stopPropagation()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Rename / move
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete}>
          <Trash />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Dashboards({ workspaceId }: DashboardsProps) {
  const [state, setState] = useQueryStates(dashboardBrowserParsers)
  const [dialog, setDialog] = useState<DashboardDialogState | null>(null)
  const router = useRouter()
  const { canEdit } = useUserPermissionsContext()
  useWorkspaceFilesRoom(workspaceId)
  const setSearch = useDebouncedSearchSetter((search, options) => setState({ search }, options))
  const search = useSearchFilterValue(state.search, SEARCH_DEBOUNCE_MS).trim()
  const query = useDashboards(workspaceId, search)
  const folderQuery = useDashboardFolders(workspaceId)
  const folders = folderQuery.data?.folders ?? []
  const dashboards = query.data?.dashboards ?? []
  const folder = folders.find((item) => item.id === state.folderId)
  const breadcrumbs = []
  let current = folder
  while (current) {
    const id = current.id
    breadcrumbs.unshift({
      label: current.name,
      onClick: () => {
        void setState({ folderId: id })
      },
    })
    current = folders.find((item) => item.id === current?.parentId)
  }
  const folderPath = breadcrumbs.length
    ? `/${breadcrumbs.map((item) => encodeURIComponent(item.label)).join('/')}`
    : ''
  const open = (id: string) => router.push(`/workspace/${workspaceId}/dashboards/${id}`)
  const folderMissing = state.folderId !== null && folderQuery.isSuccess && !folder
  return (
    <Resource>
      <Resource.Header
        icon={ChartColumn}
        title='Dashboards'
        breadcrumbs={[
          {
            label: 'Dashboards',
            onClick: () => {
              void setState({ folderId: null })
            },
          },
          ...breadcrumbs,
        ]}
        actions={
          canEdit && !folderMissing
            ? [
                { id: 'new', text: 'New dashboard', onSelect: () => setDialog({ kind: 'create' }) },
                {
                  id: 'folder',
                  text: 'New folder',
                  onSelect: () => setDialog({ kind: 'createFolder' }),
                },
              ]
            : []
        }
      />
      <Resource.Options
        search={{
          value: state.search,
          onChange: setSearch,
          placeholder: 'Search dashboards',
        }}
      />
      {(query.error || folderQuery.error) && (
        <div className='px-6 text-[var(--text-error)]' role='alert'>
          {query.error?.message ?? folderQuery.error?.message}
        </div>
      )}
      {folderMissing && (
        <p role='alert' className='p-6 text-[var(--text-error)]'>
          This folder no longer exists. Return to Dashboards to continue.
        </p>
      )}
      {query.data?.truncated && (
        <p className='px-6 text-[var(--text-muted)]'>
          Showing the first 500 results. Refine your search.
        </p>
      )}
      <Resource.Table
        columns={COLUMNS}
        rows={[
          ...folders
            .filter(
              (item) =>
                item.parentId === state.folderId &&
                (!search || item.name.toLowerCase().includes(search.toLowerCase()))
            )
            .map((item) => {
              const path = `${folderPath}/${encodeURIComponent(item.name)}`
              return {
                id: item.id,
                cells: {
                  name: { icon: <Folder />, label: item.name },
                  updated: { label: new Date(item.updatedAt).toLocaleDateString() },
                  actions: {
                    content: canEdit && (
                      <DashboardRowActions
                        label={item.name}
                        onEdit={() => setDialog({ kind: 'editFolder', folder: item, path })}
                        onDelete={() => setDialog({ kind: 'deleteFolder', folder: item, path })}
                      />
                    ),
                  },
                },
              }
            }),
          ...dashboards
            .filter((item) => search || item.folderId === state.folderId)
            .map((item) => ({
              id: item.id,
              cells: {
                name: { icon: <ChartColumn />, label: item.name },
                updated: { label: new Date(item.updatedAt).toLocaleDateString() },
                actions: {
                  content: canEdit && (
                    <DashboardRowActions
                      label={item.name}
                      onEdit={() => setDialog({ kind: 'edit', dashboard: item })}
                      onDelete={() => setDialog({ kind: 'delete', dashboard: item })}
                    />
                  ),
                },
              },
            })),
        ]}
        onRowClick={(id) => {
          if (folders.some((item) => item.id === id)) {
            void setState({ folderId: id })
          } else open(id)
        }}
        emptyState={
          query.isPending || folderQuery.isPending ? (
            <span role='status'>
              <Loader animate className='size-[16px] text-[var(--text-icon)]' />
              <span className='sr-only'>Loading dashboards</span>
            </span>
          ) : (
            <p className='p-6 text-[var(--text-muted)]'>No dashboards here yet.</p>
          )
        }
      />
      {dialog && (
        <DashboardDialog
          workspaceId={workspaceId}
          state={dialog}
          folderId={state.folderId}
          folderPath={folderPath}
          folders={folders}
          onClose={() => setDialog(null)}
          onCreated={open}
        />
      )}
    </Resource>
  )
}
