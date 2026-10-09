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
import type { FileCopySource } from '@/lib/api/contracts/file-copy-input'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
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
  if (
    source.fileIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS ||
    source.folderIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS
  ) {
    return (
      <ChipModal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        srTitle='Copy selection too large'
      >
        <ChipModalHeader icon={Duplicate} onClose={onClose}>
          Selection too large
        </ChipModalHeader>
        <ChipModalBody>
          <p>
            Select up to {MAX_WORKSPACE_FILE_BULK_REQUEST_IDS.toLocaleString()} files and{' '}
            {MAX_WORKSPACE_FILE_BULK_REQUEST_IDS.toLocaleString()} folders per copy. Reduce your
            selection and try again.
          </p>
        </ChipModalBody>
        <ChipModalFooter onCancel={onClose} defaultAction='dismiss' />
      </ChipModal>
    )
  }
  return <FileCopyDestinationPicker source={source} onClose={onClose} />
}

function FileCopyDestinationPicker({ source, onClose }: FileCopyModalProps) {
  const workspaces = useWorkspacesQuery()
  const projectsEnabled = useFeatureFlag('projects')
  const projectFilesEnabled = useFeatureFlag('project-files')
  const projectDestinationsEnabled = projectsEnabled && projectFilesEnabled
  const projects = useProjects(undefined, { enabled: projectDestinationsEnabled })
  const copy = useCopyFileItems()
  const [selection, setSelection] = useState('')
  const destinations = useMemo(() => {
    const result = new Map<string, CopyDestination>()
    for (const workspace of workspaces.data ?? [])
      result.set(`workspace:${workspace.id}`, {
        owner: { entityType: 'workspace', entityId: workspace.id },
        name: workspace.name,
      })
    for (const page of projectDestinationsEnabled ? (projects.data?.pages ?? []) : [])
      for (const project of page.projects)
        result.set(`project:${project.id}`, {
          owner: { entityType: 'project', entityId: project.id },
          name: project.name,
        })
    return result
  }, [workspaces.data, projects.data, projectDestinationsEnabled])
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
      error={
        workspaces.isError || (projectDestinationsEnabled && projects.isError)
          ? 'Could not load all destinations.'
          : undefined
      }
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
          workspaces.isPending && (!projectDestinationsEnabled || projects.isPending)
            ? 'Loading...'
            : projectDestinationsEnabled
              ? 'Choose a Project or environment'
              : 'Choose an environment'
        }
      />
      {projectDestinationsEnabled && projects.hasNextPage && (
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
