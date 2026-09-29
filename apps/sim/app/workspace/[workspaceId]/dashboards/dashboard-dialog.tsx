'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { DashboardRecord } from '@/lib/api/contracts/dashboards'
import type { FolderApi } from '@/lib/api/contracts/folders'
import { useDashboardMutation } from '@/hooks/queries/dashboards'

export type DashboardDialogState =
  | { kind: 'create' | 'createFolder' }
  | { kind: 'edit' | 'delete'; dashboard: DashboardRecord }
  | { kind: 'editFolder' | 'deleteFolder'; folder: FolderApi; path: string }
interface DashboardDialogProps {
  workspaceId: string
  state: DashboardDialogState
  folderId: string | null
  folderPath: string
  folders: FolderApi[]
  onClose: () => void
  onCreated: (id: string) => void
}
const STARTER =
  'title: New dashboard\ntime: 7d\nblocks:\n  - text: Add a table-backed chart to get started.\n'

export function DashboardDialog({
  workspaceId,
  state,
  folderId,
  folderPath,
  folders,
  onClose,
  onCreated,
}: DashboardDialogProps) {
  const [name, setName] = useState(
    'dashboard' in state ? state.dashboard.name : 'folder' in state ? state.folder.name : ''
  )
  const [target, setTarget] = useState(
    'dashboard' in state
      ? (state.dashboard.folderId ?? '')
      : 'folder' in state
        ? (state.folder.parentId ?? '')
        : (folderId ?? '')
  )
  const [content, setContent] = useState(STARTER)
  const mutation = useDashboardMutation(workspaceId)
  const deleting = state.kind === 'delete' || state.kind === 'deleteFolder'
  const title = {
    create: 'New dashboard',
    createFolder: 'New folder',
    edit: 'Edit dashboard details',
    delete: 'Delete dashboard',
    editFolder: 'Edit folder',
    deleteFolder: 'Delete folder',
  }[state.kind]
  function pathFor(id: string): string {
    const row = folders.find((folder) => folder.id === id)
    if (!row) return ''
    return `${row.parentId ? pathFor(row.parentId) : ''}/${encodeURIComponent(row.name)}`
  }
  function save() {
    const callbacks = {
      onSuccess: (result: Awaited<ReturnType<typeof mutation.mutateAsync>>) => {
        onClose()
        if (state.kind === 'create' && 'dashboard' in result) onCreated(result.dashboard.id)
      },
    }
    switch (state.kind) {
      case 'create':
        mutation.mutate({ operation: 'create', body: { name, content, folderId } }, callbacks)
        break
      case 'edit':
        mutation.mutate(
          {
            operation: 'move',
            dashboardId: state.dashboard.id,
            body: { name, folderId: target || null },
          },
          callbacks
        )
        break
      case 'delete':
        mutation.mutate({ operation: 'delete', dashboardId: state.dashboard.id }, callbacks)
        break
      case 'createFolder':
        mutation.mutate(
          { operation: 'createFolder', path: `${folderPath}/${encodeURIComponent(name)}` },
          callbacks
        )
        break
      case 'editFolder':
        mutation.mutate(
          {
            operation: 'moveFolder',
            path: state.path,
            destinationPath: `${pathFor(target)}/${encodeURIComponent(name)}`,
          },
          callbacks
        )
        break
      case 'deleteFolder':
        mutation.mutate({ operation: 'deleteFolder', path: state.path }, callbacks)
        break
    }
  }
  return (
    <ChipModal
      size={deleting ? 'sm' : 'lg'}
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {deleting ? (
          <p className='px-2 text-[var(--text-secondary)]'>
            Delete “{name}”{state.kind === 'deleteFolder' ? ' and its dashboards' : ''}?
          </p>
        ) : (
          <>
            <ChipModalField type='input' title='Name' value={name} onChange={setName} />
            {(state.kind === 'edit' || state.kind === 'editFolder') && (
              <ChipModalField
                type='dropdown'
                title='Folder'
                value={target}
                onChange={setTarget}
                options={[
                  { value: '', label: 'Dashboards' },
                  ...folders
                    .filter((folder) => !('folder' in state) || folder.id !== state.folder.id)
                    .map((folder) => ({ value: folder.id, label: pathFor(folder.id) })),
                ]}
              />
            )}
            {state.kind === 'create' && (
              <ChipModalField type='textarea' title='YAML' value={content} onChange={setContent} />
            )}
          </>
        )}
        {mutation.error && <ChipModalError>{mutation.error.message}</ChipModalError>}
      </ChipModalBody>
      <ChipModalFooter
        defaultAction={deleting ? 'dismiss' : 'primary'}
        onCancel={onClose}
        primaryAction={{
          label: deleting ? 'Delete' : 'Save',
          variant: deleting ? 'destructive' : 'primary',
          disabled: mutation.isPending || (!deleting && !name.trim()),
          onClick: save,
        }}
      />
    </ChipModal>
  )
}
