'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipTag,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  PopoverScrollArea,
} from '@sim/emcn'
import {
  BubbleChatPreview,
  ChevronRight,
  Code,
  Eye,
  RefreshCw,
  SendToBack,
  Server,
} from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { Versions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components'
import { formatVersionLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label'
import type { DeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { Preview } from '@/app/workspace/[workspaceId]/w/components/preview'
import { useDeploymentVersionState, useRevertToVersion } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('GeneralDeploy')

export type DeploymentAccessView = 'api' | 'mcp' | 'chat'

export interface DeploymentAccessMethod {
  id: DeploymentAccessView
  label: string
  description: string
  status: string
}

interface GeneralDeployProps {
  workflowId: string | null
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  isPromotingVersion: boolean
  deployReadiness: DeployReadiness
  accessMethods: DeploymentAccessMethod[]
  selectedVersion: number | null
  onSelectVersion: (version: number | null) => void
  onOpenAccessMethod: (view: DeploymentAccessView) => void
  onPromoteToLive: (version: number) => Promise<void>
  onLoadDeploymentComplete: () => void
  onLoadDeploymentBlocked: (message: string) => void
}

const ACCESS_METHOD_ICONS = {
  api: Code,
  mcp: Server,
  chat: BubbleChatPreview,
} as const

export function GeneralDeploy({
  workflowId,
  versions,
  versionsLoading,
  isPromotingVersion,
  deployReadiness,
  accessMethods,
  selectedVersion,
  onSelectVersion,
  onOpenAccessMethod,
  onPromoteToLive,
  onLoadDeploymentComplete,
  onLoadDeploymentBlocked,
}: GeneralDeployProps) {
  const [showVersionPreview, setShowVersionPreview] = useState(false)
  const [versionToRestore, setVersionToRestore] = useState<number | null>(null)
  const [versionToPromote, setVersionToPromote] = useState<number | null>(null)

  const showRestoreDialog = versionToRestore !== null
  const showPromoteDialog = versionToPromote !== null
  const selectedVersionInfo = versions.find((version) => version.version === selectedVersion)
  const versionToRestoreInfo = versions.find((version) => version.version === versionToRestore)
  const versionToPromoteInfo = versions.find((version) => version.version === versionToPromote)
  const { data: selectedVersionState, isLoading: isLoadingSelectedVersionState } =
    useDeploymentVersionState(workflowId, selectedVersion)
  const revertMutation = useRevertToVersion()

  const handleRestoreVersion = (version: number) => {
    setVersionToRestore(version)
  }

  const handlePromoteVersion = (version: number) => {
    setVersionToPromote(version)
  }

  const confirmRestoreVersion = async () => {
    if (!workflowId || versionToRestore === null) return
    const targetWorkflowId = workflowId
    const targetVersion = versionToRestore

    if (!(await deployReadiness.waitUntilReady())) {
      if (useWorkflowRegistry.getState().activeWorkflowId !== targetWorkflowId) {
        setVersionToRestore(null)
        return
      }
      onLoadDeploymentBlocked(deployReadiness.tooltip)
      return
    }

    if (useWorkflowRegistry.getState().activeWorkflowId !== targetWorkflowId) {
      setVersionToRestore(null)
      return
    }

    setVersionToRestore(null)

    try {
      await revertMutation.mutateAsync({ workflowId: targetWorkflowId, version: targetVersion })
      onLoadDeploymentComplete()
    } catch (error) {
      logger.error('Failed to restore deployment as draft', { error })
    }
  }

  const confirmPromoteVersion = async () => {
    if (!workflowId || versionToPromote === null || isPromotingVersion) return
    const targetVersion = versionToPromote

    setVersionToPromote(null)

    if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) return

    try {
      await onPromoteToLive(targetVersion)
    } catch (error) {
      logger.error('Failed to promote deployment version', { error })
    }
  }

  const renderDialogs = () => (
    <>
      <ChipConfirmModal
        open={showRestoreDialog}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setVersionToRestore(null)
        }}
        srTitle='Restore as draft'
        title='Restore as draft'
        text={[
          'Restore ',
          {
            text: versionToRestoreInfo
              ? formatVersionLabel(versionToRestoreInfo.version, versionToRestoreInfo.name)
              : `v${versionToRestore}`,
            bold: true,
          },
          ' as your editable workflow? ',
          {
            text: 'This replaces the current draft. The live deployment will not change.',
            error: true,
          },
        ]}
        confirm={{
          label: 'Restore as draft',
          onClick: confirmRestoreVersion,
          pending: revertMutation.isPending,
        }}
      />

      <ChipConfirmModal
        open={showPromoteDialog}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setVersionToPromote(null)
        }}
        srTitle='Promote to live'
        title='Promote to live'
        text={[
          'Promote ',
          {
            text: versionToPromoteInfo
              ? formatVersionLabel(versionToPromoteInfo.version, versionToPromoteInfo.name)
              : `v${versionToPromote}`,
            bold: true,
          },
          ' to live? This version will become the active deployment and serve all workflow requests.',
        ]}
        confirm={{
          label: 'Promote to live',
          onClick: confirmPromoteVersion,
          variant: 'primary',
          pending: isPromotingVersion,
        }}
      />

      {selectedVersionState && selectedVersionInfo && (
        <Modal open={showVersionPreview} onOpenChange={setShowVersionPreview}>
          <ModalContent size='full' className='flex h-[90vh] flex-col'>
            <ModalHeader>
              {formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)}
            </ModalHeader>
            <ModalBody className='!p-0 min-h-0 flex-1 overflow-hidden'>
              <ModalDescription className='sr-only'>
                Read-only preview of the selected deployment version.
              </ModalDescription>
              <Preview workflowState={selectedVersionState} autoSelectLeftmost />
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </>
  )

  if (selectedVersionInfo) {
    return (
      <>
        <div className='space-y-4'>
          <div className='rounded-sm border border-[var(--border)] bg-[var(--surface-1)] p-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <div className='flex min-w-0 items-center gap-2'>
                  <p className='truncate font-medium text-[var(--text-primary)] text-sm'>
                    {formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)}
                  </p>
                  <ChipTag variant='gray'>
                    {selectedVersionInfo.isActive ? 'Live' : 'Inactive'}
                  </ChipTag>
                </div>
                <p className='mt-1 text-[var(--text-muted)] text-xs'>
                  Deployed {formatDateTime(new Date(selectedVersionInfo.createdAt))} by{' '}
                  {selectedVersionInfo.deployedBy || 'Unknown'}
                </p>
              </div>
            </div>
            {!selectedVersionInfo.isActive && (
              <Chip
                type='button'
                variant='primary'
                fullWidth
                leftIcon={RefreshCw}
                className='mt-3 justify-center [&>span]:flex-none'
                onClick={() => handlePromoteVersion(selectedVersionInfo.version)}
                disabled={isPromotingVersion}
              >
                Promote to live
              </Chip>
            )}
          </div>

          <div>
            <Label className='mb-[6.5px] block pl-0.5 text-[var(--text-primary)] text-small'>
              Version notes
            </Label>
            <div className='min-h-[72px] rounded-sm border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5'>
              <p className='text-[var(--text-secondary)] text-small'>
                {selectedVersionInfo.description || 'No description was added for this version.'}
              </p>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <Chip
              type='button'
              variant='border'
              fullWidth
              leftIcon={Eye}
              className='justify-center [&>span]:flex-none'
              onClick={() => setShowVersionPreview(true)}
              disabled={isLoadingSelectedVersionState || !selectedVersionState}
            >
              Preview version
            </Chip>
            <Chip
              type='button'
              variant='border'
              fullWidth
              leftIcon={SendToBack}
              className='justify-center [&>span]:flex-none'
              onClick={() => handleRestoreVersion(selectedVersionInfo.version)}
            >
              Restore as draft
            </Chip>
          </div>
        </div>
        {renderDialogs()}
      </>
    )
  }

  return (
    <>
      <div>
        {accessMethods.length > 0 && (
          <section>
            <Label className='mb-[6.5px] block pl-0.5 text-[var(--text-primary)] text-small'>
              Access methods
            </Label>
            <div className='divide-y divide-[var(--border)] overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface-2)]'>
              {accessMethods.map((method) => {
                const Icon = ACCESS_METHOD_ICONS[method.id]
                return (
                  <button
                    key={method.id}
                    type='button'
                    className='group flex min-h-[58px] w-full items-center gap-3 px-3 text-left transition-colors duration-100 hover-hover:bg-[var(--surface-4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset'
                    onClick={() => onOpenAccessMethod(method.id)}
                  >
                    <span className='flex size-8 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface-1)]'>
                      <Icon className='size-[14px] text-[var(--text-icon)]' />
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='block font-medium text-[var(--text-primary)] text-small'>
                        {method.label}
                      </span>
                      <span className='block truncate text-[var(--text-muted)] text-xs'>
                        {method.description}
                      </span>
                    </span>
                    <span className='shrink-0 text-[var(--text-tertiary)] text-xs'>
                      {method.status}
                    </span>
                    <ChevronRight className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {accessMethods.length > 0 && <div className='-mx-4 mt-5 h-px bg-[var(--border)]' />}

        <section className={accessMethods.length > 0 ? 'mt-3' : undefined}>
          <div className='mb-[6.5px] pl-0.5'>
            <Label className='text-[var(--text-primary)] text-small'>Version history</Label>
          </div>
          <PopoverScrollArea
            fadeVariant='panel'
            bottomFade={false}
            scrollbar='hidden'
            className='max-h-[260px] pb-20'
          >
            <Versions
              workflowId={workflowId}
              versions={versions}
              versionsLoading={versionsLoading}
              isPromotingVersion={isPromotingVersion}
              onSelectVersion={onSelectVersion}
              onPromoteToLive={handlePromoteVersion}
              onLoadDeployment={handleRestoreVersion}
            />
          </PopoverScrollArea>
        </section>
      </div>
      {renderDialogs()}
    </>
  )
}
