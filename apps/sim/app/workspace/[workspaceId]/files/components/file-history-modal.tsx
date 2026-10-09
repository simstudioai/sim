'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  toast,
  useScrollEdges,
} from '@sim/emcn'
import { Clock, Download, RefreshCw } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { V2FileVersion } from '@/lib/api/contracts/v2/file-versions'
import { saveBlob } from '@/lib/uploads/client/download'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { useFileNavigation } from '@/app/workspace/[workspaceId]/files/components/file-detail'
import {
  useDownloadFileVersion,
  useFileHistory,
  useRevertFileVersion,
} from '@/hooks/queries/file-history'

interface FileHistoryModalProps {
  owner: EditableFileOwner
  fileId: string
  fileName: string
  canWrite: boolean
  onClose: () => void
}

export function FileHistoryModal({
  owner,
  fileId,
  fileName,
  canWrite,
  onClose,
}: FileHistoryModalProps) {
  const history = useFileHistory(owner, fileId, true)
  const revert = useRevertFileVersion(owner, fileId)
  const download = useDownloadFileVersion(owner, fileId)
  const navigation = useFileNavigation({ owner })
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const [target, setTarget] = useState<{ version: number; expectedRevision: string } | null>(null)
  const edges = useScrollEdges(scrollElement)
  const versions = history.data?.pages.flatMap((page) => page.versions) ?? []
  const revision = history.data?.pages[0]?.revision
  const hasDraft =
    navigation.fileId === fileId && (navigation.isDirty || navigation.saveStatus === 'saving')
  const canRevert =
    canWrite && history.isFetchedAfterMount && !history.isError && Boolean(revision) && !hasDraft

  async function downloadVersion(version: number) {
    try {
      const response = await download.mutateAsync(version)
      saveBlob(await response.blob(), `v${version}-${fileName}`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to download version'))
    }
  }

  async function confirmRevert() {
    if (!target || !canRevert) return
    try {
      const result = await revert.mutateAsync(target)
      setTarget(null)
      toast.success(result.reverted ? 'File reverted' : 'This version is already current')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revert file'))
      setTarget(null)
    }
  }

  return (
    <>
      <ChipModal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        size='lg'
        dismissDisabled={revert.isPending}
        srTitle={`Version history for ${fileName}`}
      >
        <ChipModalHeader icon={Clock} onClose={onClose}>
          Version History
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='custom'
            title={fileName}
            error={
              history.isError ? getErrorMessage(history.error, 'Failed to load history') : undefined
            }
            hint={hasDraft ? 'Save or discard your changes before reverting.' : undefined}
          >
            <div
              ref={setScrollElement}
              className={cn('max-h-[420px] overflow-y-auto', scrollFadeClass)}
              {...scrollFadeAttributes(edges)}
            >
              <div className='flex flex-col gap-3 py-1'>
                {history.isPending && (
                  <p className='text-[var(--text-muted)] text-caption'>Loading history...</p>
                )}
                {!history.isPending && !history.isError && versions.length === 0 && (
                  <p className='text-[var(--text-muted)] text-caption'>No recorded versions.</p>
                )}
                {versions.map((version) => (
                  <FileHistoryRow
                    key={version.version}
                    version={version}
                    busy={download.isPending || revert.isPending}
                    canRevert={canRevert}
                    onDownload={() => void downloadVersion(version.version)}
                    onRevert={() => {
                      if (revision)
                        setTarget({ version: version.version, expectedRevision: revision })
                    }}
                  />
                ))}
                {history.hasNextPage && (
                  <Chip
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? 'Loading...' : 'Load more'}
                  </Chip>
                )}
              </div>
            </div>
          </ChipModalField>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={onClose}
          cancelLabel='Close'
          defaultAction='dismiss'
          secondaryActions={[
            {
              label: 'Refresh',
              leftAdornment: <RefreshCw />,
              disabled: history.isFetching || revert.isPending,
              onClick: () => void history.refetch(),
            },
          ]}
        />
      </ChipModal>
      <ChipConfirmModal
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={`Revert to version ${target?.version ?? ''}?`}
        text='This writes the selected content as a new version. Your current version remains in history.'
        confirm={{
          label: 'Revert',
          variant: 'primary',
          pending: revert.isPending,
          pendingLabel: 'Reverting...',
          disabled: !canRevert,
          onClick: () => void confirmRevert(),
        }}
      />
    </>
  )
}

interface FileHistoryRowProps {
  version: V2FileVersion
  busy: boolean
  canRevert: boolean
  onDownload: () => void
  onRevert: () => void
}

function FileHistoryRow({ version, busy, canRevert, onDownload, onRevert }: FileHistoryRowProps) {
  const authors = version.authors
    .map((author) => author.email ?? `Deleted user (${author.id})`)
    .join(', ')
  return (
    <div className='flex items-center gap-3'>
      <div className='min-w-0 flex-1'>
        <p className='text-small'>
          Version {version.version}
          {version.isCurrent ? ' · Current' : ''}
        </p>
        <OverflowText
          className='text-[var(--text-muted)] text-caption'
          label={`${authors || 'System'} · ${version.source} · ${formatFileSize(version.size, { includeBytes: true })}`}
        />
        <p className='text-[var(--text-muted)] text-caption'>
          {new Date(version.updatedAt).toLocaleString()}
        </p>
      </div>
      <Chip
        leftIcon={Download}
        disabled={busy}
        onClick={onDownload}
        aria-label={`Download version ${version.version}`}
      >
        Download
      </Chip>
      {!version.isCurrent && canRevert && (
        <Chip
          disabled={busy}
          onClick={onRevert}
          aria-label={`Revert to version ${version.version}`}
        >
          Revert
        </Chip>
      )}
    </div>
  )
}
