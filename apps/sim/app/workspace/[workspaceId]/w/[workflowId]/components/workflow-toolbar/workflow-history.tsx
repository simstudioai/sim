'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import {
  Clock,
  MoreVertical,
  NotepadText,
  Pencil,
  RotateCcw,
  SendToBack,
  Trash2,
  X,
} from 'lucide-react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { formatDateTime } from '@/lib/core/utils/formatting'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { VersionDescriptionModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/version-description-modal'
import {
  useActivateDeploymentVersion,
  useDeploymentVersions,
  useUpdateDeploymentVersion,
} from '@/hooks/queries/deployments'
import { useRevertToVersion } from '@/hooks/queries/workflows'
import type { WorkflowSnapshot } from '@/stores/workflow-history'
import { useWorkflowHistoryStore } from '@/stores/workflow-history'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowHistory')

function formatTime(isoTimestamp: string): string {
  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(isoTimestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface WorkflowHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const WorkflowHistory = memo(function WorkflowHistory({
  open,
  onOpenChange,
}: WorkflowHistoryProps) {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const snapshots = useWorkflowHistoryStore((state) =>
    activeWorkflowId ? state.getSnapshots(activeWorkflowId) : []
  )
  const restoreSnapshot = useWorkflowHistoryStore((state) => state.restoreSnapshot)
  const clearHistory = useWorkflowHistoryStore((state) => state.clearHistory)

  const { data: versionsData, isLoading: versionsLoading } = useDeploymentVersions(
    activeWorkflowId,
    { enabled: open }
  )
  const versions = versionsData?.versions ?? []

  const activateVersionMutation = useActivateDeploymentVersion()
  const revertMutation = useRevertToVersion()
  const renameMutation = useUpdateDeploymentVersion()

  const [openDropdown, setOpenDropdown] = useState<number | null>(null)

  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const [descriptionModalVersion, setDescriptionModalVersion] = useState<number | null>(null)

  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionToPromote, setVersionToPromote] = useState<number | null>(null)

  const versionToLoadInfo = versions.find((v) => v.version === versionToLoad)
  const versionToPromoteInfo = versions.find((v) => v.version === versionToPromote)
  const descriptionModalVersionData =
    descriptionModalVersion !== null
      ? versions.find((v) => v.version === descriptionModalVersion)
      : null

  useEffect(() => {
    if (editingVersion !== null && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingVersion])

  useEffect(() => {
    if (!open) {
      setOpenDropdown(null)
      setEditingVersion(null)
      setEditValue('')
    }
  }, [open])

  const handleRestore = useCallback(
    (snapshot: WorkflowSnapshot) => {
      if (!activeWorkflowId) return
      restoreSnapshot(activeWorkflowId, snapshot.id)
      onOpenChange(false)
    },
    [activeWorkflowId, restoreSnapshot, onOpenChange]
  )

  const handleClear = useCallback(() => {
    if (!activeWorkflowId) return
    clearHistory(activeWorkflowId)
  }, [activeWorkflowId, clearHistory])

  const handleStartRename = useCallback(
    (version: number, currentName: string | null | undefined) => {
      setOpenDropdown(null)
      setEditingVersion(version)
      setEditValue(currentName || `v${version}`)
    },
    []
  )

  const handleSaveRename = useCallback(
    (version: number) => {
      if (renameMutation.isPending) return
      if (!activeWorkflowId || !editValue.trim()) {
        setEditingVersion(null)
        return
      }

      const currentVersion = versions.find((v) => v.version === version)
      const currentName = currentVersion?.name || `v${version}`

      if (editValue.trim() === currentName) {
        setEditingVersion(null)
        return
      }

      renameMutation.mutate(
        {
          workflowId: activeWorkflowId,
          version,
          name: editValue.trim(),
        },
        {
          onSuccess: () => setEditingVersion(null),
        }
      )
    },
    [activeWorkflowId, editValue, versions, renameMutation]
  )

  const handleCancelRename = useCallback(() => {
    setEditingVersion(null)
    setEditValue('')
  }, [])

  const handleOpenDescriptionModal = useCallback((version: number) => {
    setOpenDropdown(null)
    setDescriptionModalVersion(version)
  }, [])

  const handlePromote = useCallback((version: number) => {
    setOpenDropdown(null)
    setVersionToPromote(version)
    setShowPromoteDialog(true)
  }, [])

  const handleLoadDeployment = useCallback((version: number) => {
    setOpenDropdown(null)
    setVersionToLoad(version)
    setShowLoadDialog(true)
  }, [])

  const confirmPromoteToLive = useCallback(async () => {
    if (!activeWorkflowId || versionToPromote === null) return
    setShowPromoteDialog(false)
    const version = versionToPromote
    setVersionToPromote(null)

    try {
      await activateVersionMutation.mutateAsync({
        workflowId: activeWorkflowId,
        version,
      })
    } catch (error) {
      logger.error('Failed to promote version:', error)
    }
  }, [activeWorkflowId, versionToPromote, activateVersionMutation])

  const confirmLoadDeployment = useCallback(async () => {
    if (!activeWorkflowId || versionToLoad === null) return
    setShowLoadDialog(false)
    const version = versionToLoad
    setVersionToLoad(null)
    onOpenChange(false)

    try {
      await revertMutation.mutateAsync({ workflowId: activeWorkflowId, version })
    } catch (error) {
      logger.error('Failed to load deployment:', error)
    }
  }, [activeWorkflowId, versionToLoad, revertMutation, onOpenChange])

  const hasVersions = versions.length > 0
  const hasSnapshots = snapshots.length > 0
  const isEmpty = !hasVersions && !hasSnapshots && !versionsLoading

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange} size='sm'>
        <Tooltip.Root>
          <PopoverTrigger asChild>
            <Tooltip.Trigger asChild>
              <Button
                className='h-[28px] w-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
                variant={open ? 'active' : 'ghost'}
                aria-label='Change history'
              >
                <Clock className='h-[16px] w-[16px]' />
              </Button>
            </Tooltip.Trigger>
          </PopoverTrigger>
          {!open && <Tooltip.Content side='right'>Change history</Tooltip.Content>}
        </Tooltip.Root>
        <PopoverContent
          align='start'
          side='right'
          sideOffset={8}
          maxHeight={480}
          style={{ minWidth: '300px', maxWidth: '340px' }}
          onPointerDownOutside={(e) => {
            e.preventDefault()
            requestAnimationFrame(() => onOpenChange(false))
          }}
        >
          {/* Header */}
          <div className='flex items-center justify-between px-2 pt-0.5 pb-1'>
            <span className='font-medium text-[12px] text-[var(--text-primary)]'>
              Change History
            </span>
            <Button
              variant='ghost'
              className='!h-5 !w-5 !p-0 text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-3 w-3' />
            </Button>
          </div>

          {isEmpty ? (
            <div className='flex flex-col items-center gap-1.5 px-2 py-6'>
              <Clock className='h-5 w-5 text-[var(--text-muted)]' />
              <span className='text-center text-[12px] text-[var(--text-muted)]'>
                No history yet
              </span>
              <span className='text-center text-[11px] text-[var(--text-subtle)]'>
                Deploy your workflow or make edits to see history
              </span>
            </div>
          ) : (
            <PopoverScrollArea>
              {/* Deployment Versions Section */}
              {(hasVersions || versionsLoading) && (
                <>
                  <PopoverSection>Deployment Versions</PopoverSection>
                  {versionsLoading && !hasVersions ? (
                    <div className='flex items-center justify-center py-3'>
                      <span className='text-[11px] text-[var(--text-muted)]'>Loading...</span>
                    </div>
                  ) : (
                    versions.map((v) => (
                      <VersionRow
                        key={v.id}
                        version={v}
                        workflowId={activeWorkflowId}
                        editingVersion={editingVersion}
                        editValue={editValue}
                        inputRef={inputRef}
                        openDropdown={openDropdown}
                        renamePending={renameMutation.isPending}
                        onEditValueChange={setEditValue}
                        onSaveRename={handleSaveRename}
                        onCancelRename={handleCancelRename}
                        onStartRename={handleStartRename}
                        onOpenDropdown={setOpenDropdown}
                        onOpenDescription={handleOpenDescriptionModal}
                        onPromote={handlePromote}
                        onLoadDeployment={handleLoadDeployment}
                      />
                    ))
                  )}
                </>
              )}

              {/* Recent Changes Section */}
              {hasSnapshots && (
                <>
                  {hasVersions && <div className='mx-2 my-1 border-[var(--border)] border-t' />}
                  <PopoverSection>Recent Changes</PopoverSection>
                  {snapshots.map((snapshot) => (
                    <PopoverItem key={snapshot.id} onClick={() => handleRestore(snapshot)}>
                      <RotateCcw className='h-3 w-3 flex-shrink-0 text-[var(--text-muted)]' />
                      <span className='flex-1 truncate text-[12px]'>{snapshot.label}</span>
                      <span className='flex-shrink-0 text-[10px] text-[var(--text-muted)]'>
                        {formatTime(snapshot.timestamp)}
                      </span>
                    </PopoverItem>
                  ))}
                  <div className='border-[var(--border)] border-t pt-1'>
                    <PopoverItem onClick={handleClear}>
                      <Trash2 className='h-3 w-3 flex-shrink-0 text-[var(--text-muted)]' />
                      <span className='text-[12px]'>Clear local history</span>
                    </PopoverItem>
                  </div>
                </>
              )}
            </PopoverScrollArea>
          )}
        </PopoverContent>
      </Popover>

      {/* Confirmation: Load Deployment */}
      <Modal open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Load Deployment</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to load{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {versionToLoadInfo?.name || `v${versionToLoad}`}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                This will replace your current workflow with the deployed version.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowLoadDialog(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmLoadDeployment}>
              Load deployment
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirmation: Promote to Live */}
      <Modal open={showPromoteDialog} onOpenChange={setShowPromoteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Promote to live</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to promote{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {versionToPromoteInfo?.name || `v${versionToPromote}`}
              </span>{' '}
              to live?{' '}
              <span className='text-[var(--text-primary)]'>
                This version will become the active deployment and serve all API requests.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowPromoteDialog(false)}>
              Cancel
            </Button>
            <Button variant='tertiary' onClick={confirmPromoteToLive}>
              Promote to live
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Version Description Modal */}
      {activeWorkflowId && descriptionModalVersionData && (
        <VersionDescriptionModal
          key={descriptionModalVersionData.version}
          open={descriptionModalVersion !== null}
          onOpenChange={(openState) => !openState && setDescriptionModalVersion(null)}
          workflowId={activeWorkflowId}
          version={descriptionModalVersionData.version}
          versionName={
            descriptionModalVersionData.name || `v${descriptionModalVersionData.version}`
          }
          currentDescription={descriptionModalVersionData.description}
        />
      )}
    </>
  )
})

interface VersionRowProps {
  version: WorkflowDeploymentVersionResponse
  workflowId: string | null
  editingVersion: number | null
  editValue: string
  inputRef: React.RefObject<HTMLInputElement | null>
  openDropdown: number | null
  renamePending: boolean
  onEditValueChange: (value: string) => void
  onSaveRename: (version: number) => void
  onCancelRename: () => void
  onStartRename: (version: number, currentName: string | null | undefined) => void
  onOpenDropdown: (version: number | null) => void
  onOpenDescription: (version: number) => void
  onPromote: (version: number) => void
  onLoadDeployment: (version: number) => void
}

function VersionRow({
  version: v,
  editingVersion,
  editValue,
  inputRef,
  openDropdown,
  renamePending,
  onEditValueChange,
  onSaveRename,
  onCancelRename,
  onStartRename,
  onOpenDropdown,
  onOpenDescription,
  onPromote,
  onLoadDeployment,
}: VersionRowProps) {
  const isEditing = editingVersion === v.version

  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-sm px-2 py-1.5',
        'hover-hover:bg-[var(--surface-5)]',
        'transition-colors duration-100'
      )}
    >
      {/* Status dot */}
      <div
        className={clsx(
          'h-[6px] w-[6px] shrink-0 rounded-xs',
          v.isActive ? 'bg-[var(--indicator-active)]' : 'bg-[var(--indicator-inactive)]'
        )}
        title={v.isActive ? 'Live' : 'Inactive'}
      />

      {/* Version name + timestamp */}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSaveRename(v.version)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancelRename()
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onSaveRename(v.version)}
            className='w-full border-0 bg-transparent p-0 font-medium text-[12px] text-[var(--text-primary)] leading-4 outline-none focus:outline-none focus:ring-0'
            maxLength={100}
            disabled={renamePending}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
          />
        ) : (
          <span className='flex items-center gap-1 truncate font-medium text-[12px] text-[var(--text-primary)]'>
            <span className='truncate'>{v.name || `v${v.version}`}</span>
            {v.isActive && <span className='text-[10px] text-[var(--text-tertiary)]'>(live)</span>}
          </span>
        )}
        <span className='truncate text-[10px] text-[var(--text-muted)]'>
          {formatDateTime(new Date(v.createdAt))}
          {v.deployedBy ? ` · ${v.deployedBy}` : ''}
        </span>
      </div>

      {/* Actions */}
      <div className='flex shrink-0 items-center gap-0.5' onClick={(e) => e.stopPropagation()}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className={clsx(
                '!h-5 !w-5 !p-0',
                !v.description &&
                  'text-[var(--text-quaternary)] hover-hover:text-[var(--text-tertiary)]'
              )}
              onClick={() => onOpenDescription(v.version)}
            >
              <NotepadText className='h-3 w-3' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top' className='max-w-[200px]'>
            {v.description ? (
              <p className='line-clamp-3 text-[11px]'>{v.description}</p>
            ) : (
              <p className='text-[11px]'>Add description</p>
            )}
          </Tooltip.Content>
        </Tooltip.Root>

        <Popover
          open={openDropdown === v.version}
          onOpenChange={(isOpen) => onOpenDropdown(isOpen ? v.version : null)}
        >
          <PopoverTrigger asChild>
            <Button variant='ghost' className='!h-5 !w-5 !p-0'>
              <MoreVertical className='h-3 w-3' />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
            sideOffset={4}
            minWidth={160}
            maxWidth={200}
            border
            disablePortal
          >
            <PopoverItem onClick={() => onStartRename(v.version, v.name)}>
              <Pencil className='h-3 w-3' />
              <span>Rename</span>
            </PopoverItem>
            {!v.isActive && (
              <PopoverItem onClick={() => onPromote(v.version)}>
                <RotateCcw className='h-3 w-3' />
                <span>Promote to live</span>
              </PopoverItem>
            )}
            <PopoverItem onClick={() => onLoadDeployment(v.version)}>
              <SendToBack className='h-3 w-3' />
              <span>Load deployment</span>
            </PopoverItem>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
