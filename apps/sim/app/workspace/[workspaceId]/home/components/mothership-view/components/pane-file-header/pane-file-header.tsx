'use client'

import { type ReactNode, useState } from 'react'
import { ChipConfirmModal, toast, useCopyToClipboard } from '@sim/emcn'
import { Check, Link, Pencil, Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useDeleteWorkspaceFile,
  useRenameWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'
import { useInlineRename } from '@/hooks/use-inline-rename'

interface PaneFileHeaderProps {
  workspaceId: string
  resource: MothershipResource
  onBrowse?: () => void
  aside: ReactNode
}

/** A file tab's header in a pane: the Files page's name menu, acting on this tab's file. */
export function PaneFileHeader({ workspaceId, resource, onBrowse, aside }: PaneFileHeaderProps) {
  const { canEdit } = useUserPermissionsContext()
  const { removeResource } = useMothershipResources()
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const file = files.find((candidate) => candidate.id === resource.id)
  const renameFile = useRenameWorkspaceFile()
  const deleteFile = useDeleteWorkspaceFile()
  const rename = useInlineRename({
    onSave: (fileId, name) => renameFile.mutateAsync({ workspaceId, fileId, name }),
  })
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const editable = Boolean(file) && canEdit && file?.vfsNamespace !== 'uploads'

  const handleDelete = async () => {
    try {
      await deleteFile.mutateAsync({ workspaceId, fileId: resource.id })
      setConfirmingDelete(false)
      removeResource(resource.type, resource.id, resource.workspaceId)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete file'))
    }
  }

  return (
    <>
      <Resource.Header
        icon={getResourceConfig(resource.type).icon}
        breadcrumbs={[
          { label: getResourceConfig(resource.type).label, onClick: onBrowse },
          {
            label: file?.name ?? resource.title,
            editing: rename.editingId
              ? {
                  isEditing: true,
                  value: rename.editValue,
                  onChange: rename.setEditValue,
                  onSubmit: rename.submitRename,
                  onCancel: rename.cancelRename,
                }
              : undefined,
            dropdownItems: file
              ? [
                  {
                    label: copied ? 'Copied!' : 'Copy Link',
                    icon: copied ? Check : Link,
                    onClick: () =>
                      void copy(
                        `${window.location.origin}/workspace/${workspaceId}/files/${file.id}`
                      ),
                  },
                  ...(editable
                    ? [
                        {
                          label: 'Rename',
                          icon: Pencil,
                          onClick: () => rename.startRename(file.id, file.name),
                        },
                        { label: 'Delete', icon: Trash, onClick: () => setConfirmingDelete(true) },
                      ]
                    : []),
                ]
              : undefined,
          },
        ]}
        aside={aside}
      />
      <ChipConfirmModal
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        srTitle='Delete File'
        title='Delete File'
        defaultAction='dismiss'
        text={[
          'Are you sure you want to delete ',
          { text: file?.name ?? 'this file', bold: true },
          '? You can restore it from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: () => void handleDelete(),
          pending: deleteFile.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
