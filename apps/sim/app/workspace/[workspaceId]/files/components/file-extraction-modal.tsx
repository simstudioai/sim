import { ChipConfirmModal } from '@sim/emcn'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { useExtractFile } from '@/hooks/queries/file-extraction'

interface FileExtractionModalProps {
  owner: EditableFileOwner
  fileId: string
  fileName: string
  canWrite: boolean
  onClose: () => void
}

export function FileExtractionModal({
  owner,
  fileId,
  fileName,
  canWrite,
  onClose,
}: FileExtractionModalProps) {
  const extract = useExtractFile(owner)
  return (
    <ChipConfirmModal
      open
      onOpenChange={(open) => {
        if (!open && !extract.isPending) onClose()
      }}
      title='Unzip archive?'
      defaultAction='confirm'
      text={['This will unzip ', { text: fileName, bold: true }, ' into a new folder beside it.']}
      confirm={{
        label: 'Unzip',
        onClick: () => {
          if (!canWrite || extract.isPending) return
          extract.mutate({ fileId, fileName }, { onSuccess: onClose })
        },
        variant: 'primary',
        pending: extract.isPending,
        pendingLabel: 'Unzipping...',
        disabled: !canWrite,
      }}
    />
  )
}
