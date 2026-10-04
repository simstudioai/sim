'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  toast,
} from '@sim/emcn'
import { Duplicate } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { FileCopySource } from '@/lib/api/contracts/mothership-file-copy'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { useCopyFileItems, useFileCopyDestination } from '@/hooks/queries/file-copy'
import { useProjects } from '@/hooks/queries/projects'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface FileCopyModalProps {
  source: FileCopySource
  onClose: () => void
}

interface CopyDestination {
  owner: EditableFileOwner
  name: string
}

export function FileCopyModal({ source, onClose }: FileCopyModalProps) {
  const workspaces = useWorkspacesQuery()
  const projects = useProjects()
  const copy = useCopyFileItems()
  const [selection, setSelection] = useState('')
  const destinations = useMemo(() => {
    const result = new Map<string, CopyDestination>()
    for (const workspace of workspaces.data ?? [])
      result.set(`workspace:${workspace.id}`, {
        owner: { entityType: 'workspace', entityId: workspace.id },
        name: workspace.name,
      })
    for (const page of projects.data?.pages ?? [])
      for (const project of page.projects)
        result.set(`project:${project.id}`, {
          owner: { entityType: 'project', entityId: project.id },
          name: project.name,
        })
    return result
  }, [workspaces.data, projects.data])
  const destination = destinations.get(selection)
  const groups = ['project', 'workspace'].map((kind) => ({
    section: kind === 'project' ? 'Projects' : 'Environments',
    items: [...destinations]
      .filter(([, item]) => item.owner.entityType === kind)
      .map(([value, item]) => ({ value, label: item.name })),
  }))
  const destinationField = (
    <ChipModalField
      type='custom'
      title='Destination'
      hint='Copies saved content. The original files stay in their current location.'
      error={workspaces.isError && projects.isError ? 'Could not load destinations.' : undefined}
    >
      <ChipSelect
        aria-label='Copy destination'
        groups={groups}
        value={selection}
        onChange={setSelection}
        disabled={copy.isPending}
        searchable
        fullWidth
        placeholder={
          workspaces.isPending && projects.isPending
            ? 'Loading...'
            : 'Choose a Project or environment'
        }
      />
      {projects.hasNextPage && (
        <Chip disabled={projects.isFetchingNextPage} onClick={() => void projects.fetchNextPage()}>
          {projects.isFetchingNextPage ? 'Loading...' : 'Load more Projects'}
        </Chip>
      )}
    </ChipModalField>
  )

  if (destination)
    return (
      <CopyDestinationForm
        key={selection}
        source={source}
        destination={destination}
        onClose={onClose}
        destinationField={destinationField}
        copy={copy}
      />
    )
  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Copy files'
    >
      <ChipModalHeader icon={Duplicate} onClose={onClose}>
        Copy to
      </ChipModalHeader>
      <ChipModalBody>{destinationField}</ChipModalBody>
      <ChipModalFooter onCancel={onClose} defaultAction='dismiss' />
    </ChipModal>
  )
}

interface CopyDestinationFormProps extends FileCopyModalProps {
  destination: CopyDestination
  destinationField: ReactNode
  copy: ReturnType<typeof useCopyFileItems>
}

function CopyDestinationForm({
  source,
  destination,
  onClose,
  destinationField,
  copy,
}: CopyDestinationFormProps) {
  const folders = useFileCopyDestination(destination.owner)
  const [folderId, setFolderId] = useState('root')
  const ready = folders.isFetchedAfterMount && !folders.isError && folders.data?.canWrite
  const folder = folders.data?.folders.find((item) => item.id === folderId)
  const validFolder = folderId === 'root' || Boolean(folder)
  const count = source.fileIds.length + source.folderIds.length

  async function submit() {
    if (!ready || !validFolder || copy.isPending) return
    try {
      await copy.mutateAsync({
        source,
        destination: { owner: destination.owner, folderId: folder?.id ?? null },
      })
      toast.success(`Copied ${count === 1 ? 'item' : `${count} items`} to ${destination.name}`)
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to copy files'))
    }
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      dismissDisabled={copy.isPending}
      srTitle='Copy files'
    >
      <ChipModalHeader icon={Duplicate} onClose={onClose}>
        Copy to
      </ChipModalHeader>
      <ChipModalBody>
        {destinationField}
        <ChipModalField
          type='custom'
          title='Folder'
          error={
            folders.isError ? getErrorMessage(folders.error, 'Failed to load folders') : undefined
          }
          hint={
            folders.isFetchedAfterMount && !folders.isError && !folders.data?.canWrite
              ? 'You have read-only access to this destination.'
              : undefined
          }
        >
          <ChipSelect
            aria-label='Destination folder'
            value={folderId}
            onChange={setFolderId}
            disabled={!ready || copy.isPending}
            fullWidth
            searchable
            options={[
              { value: 'root', label: 'Files' },
              ...(folders.data?.folders ?? []).map((folder) => ({
                value: folder.id,
                label: folder.path || folder.name,
              })),
            ]}
          />
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: copy.isPending ? 'Copying...' : 'Copy',
          disabled: !ready || !validFolder || copy.isPending,
          onClick: () => void submit(),
        }}
      />
    </ChipModal>
  )
}
