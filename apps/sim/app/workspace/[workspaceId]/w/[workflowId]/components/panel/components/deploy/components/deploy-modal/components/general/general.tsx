'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  ChipConfirmModal,
  Expand,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  Skeleton,
  Tooltip,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import type { DeployReadiness } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
import { Preview, PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { useDeploymentVersionState, useRevertToVersion } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { Versions } from './components'
import { formatVersionLabel } from './format-version-label'
import { useTranslations } from 'next-intl'

const logger = createLogger('GeneralDeploy')

interface GeneralDeployProps {
  workflowId: string | null
  deployedState?: WorkflowState | null
  isLoadingDeployedState: boolean
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  isPromotingVersion: boolean
  deployReadiness: DeployReadiness
  onPromoteToLive: (version: number) => Promise<void>
  onLoadDeploymentComplete: () => void
  onLoadDeploymentBlocked: (message: string) => void
}

type PreviewMode = 'active' | 'selected'

/**
 * General deployment tab content displaying live workflow preview and version history.
 */
export function GeneralDeploy({
  workflowId,
  deployedState,
  isLoadingDeployedState,
  versions,
  versionsLoading,
  isPromotingVersion,
  deployReadiness,
  onPromoteToLive,
  onLoadDeploymentComplete,
  onLoadDeploymentBlocked,
}: GeneralDeployProps) {
  const t = useTranslations('auto')
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [showActiveDespiteSelection, setShowActiveDespiteSelection] = useState(false)
  const previewMode: PreviewMode =
    selectedVersion !== null && !showActiveDespiteSelection ? 'selected' : 'active'
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [showExpandedPreview, setShowExpandedPreview] = useState(false)
  const [versionToLoad, setVersionToLoad] = useState<{
    workflowId: string
    version: number
  } | null>(null)
  const [versionToPromote, setVersionToPromote] = useState<{
    workflowId: string
    version: number
  } | null>(null)

  const selectedVersionInfo = versions.find((v) => v.version === selectedVersion)
  const versionToPromoteInfo = versions.find((v) => v.version === versionToPromote?.version)
  const versionToLoadInfo = versions.find((v) => v.version === versionToLoad?.version)

  const { data: selectedVersionState } = useDeploymentVersionState(workflowId, selectedVersion)

  const revertMutation = useRevertToVersion()

  const handleSelectVersion = (version: number | null) => {
    setSelectedVersion(version)
    setShowActiveDespiteSelection(false)
  }

  const handleLoadDeployment = (version: number) => {
    if (!workflowId) return
    setVersionToLoad({ workflowId, version })
    setShowLoadDialog(true)
  }

  const handlePromoteToLive = (version: number) => {
    if (!workflowId) return
    setVersionToPromote({ workflowId, version })
    setShowPromoteDialog(true)
  }

  const confirmLoadDeployment = async () => {
    if (!versionToLoad) return
    const target = versionToLoad
    if (!(await deployReadiness.waitUntilReady())) {
      if (
        workflowId !== target.workflowId ||
        useWorkflowRegistry.getState().activeWorkflowId !== target.workflowId
      ) {
        setShowLoadDialog(false)
        setVersionToLoad(null)
        return
      }
      onLoadDeploymentBlocked(deployReadiness.tooltip)
      return
    }
    if (
      workflowId !== target.workflowId ||
      useWorkflowRegistry.getState().activeWorkflowId !== target.workflowId
    ) {
      setShowLoadDialog(false)
      setVersionToLoad(null)
      return
    }

    setShowLoadDialog(false)
    setVersionToLoad(null)

    try {
      await revertMutation.mutateAsync({ workflowId: target.workflowId, version: target.version })
      onLoadDeploymentComplete()
    } catch (error) {
      logger.error('Failed to load deployment:', error)
    }
  }

  useEffect(() => {
    setShowLoadDialog(false)
    setVersionToLoad(null)
    setShowPromoteDialog(false)
    setVersionToPromote(null)
  }, [workflowId])

  const confirmPromoteToLive = async () => {
    if (!versionToPromote || isPromotingVersion) return
    const target = versionToPromote

    setShowPromoteDialog(false)
    setVersionToPromote(null)

    if (
      workflowId !== target.workflowId ||
      useWorkflowRegistry.getState().activeWorkflowId !== target.workflowId
    ) {
      return
    }

    try {
      await onPromoteToLive(target.version)
    } catch (error) {
      logger.error('Failed to promote version:', error)
    }
  }

  const workflowToShow =
    previewMode === 'selected' && selectedVersionState ? selectedVersionState : deployedState

  const showToggle = selectedVersion !== null && deployedState

  const hasDeployedData = deployedState && Object.keys(deployedState.blocks || {}).length > 0
  const showLoadingSkeleton = isLoadingDeployedState && !hasDeployedData

  if (showLoadingSkeleton) {
    return (
      <div className='space-y-3'>
        <div>
          <div className='relative mb-[6.5px]'>
            <Skeleton className='h-[16px] w-[90px]' />
          </div>
          <div className='h-[260px] w-full overflow-hidden rounded-sm border border-[var(--border)]'>
            <Skeleton className='h-full w-full rounded-none' />
          </div>
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[60px]' />
          <div className='h-[120px] w-full overflow-hidden rounded-sm border border-[var(--border)]'>
            <Skeleton className='h-full w-full rounded-none' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className='space-y-3'>
        <div>
          <div className='relative mb-[6.5px]'>
            <Label className='block truncate pl-0.5 font-medium text-[var(--text-primary)] text-small'>
              {previewMode === 'selected' && selectedVersionInfo
                ? formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)
                : 'Live Workflow'}
            </Label>
            <div className={cn('absolute top-[-5px] right-0', !showToggle && 'invisible')}>
              <ButtonGroup
                value={previewMode}
                onValueChange={(val) =>
                  setShowActiveDespiteSelection((val as PreviewMode) === 'active')
                }
              >
                <ButtonGroupItem value='active'>{t('live')}</ButtonGroupItem>
                <ButtonGroupItem value='selected' className='truncate'>
                  {selectedVersionInfo
                    ? formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)
                    : `v${selectedVersion}`}
                </ButtonGroupItem>
              </ButtonGroup>
            </div>
          </div>

          <div
            className='relative h-[260px] w-full overflow-hidden rounded-sm border border-[var(--border)]'
            onWheelCapture={(e) => {
              if (e.ctrlKey || e.metaKey) return
              e.stopPropagation()
            }}
          >
            {workflowToShow ? (
              <>
                <div className='[&_*]:!cursor-default h-full w-full cursor-default'>
                  <PreviewWorkflow
                    workflowState={workflowToShow}
                    height='100%'
                    width='100%'
                    isPannable={true}
                    defaultPosition={{ x: 0, y: 0 }}
                    defaultZoom={0.6}
                  />
                </div>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='default'
                      onClick={() => setShowExpandedPreview(true)}
                      className='absolute right-[8px] bottom-2 z-10 size-[28px] cursor-pointer border border-[var(--border)] bg-transparent p-0 backdrop-blur-sm hover-hover:bg-[var(--surface-3)]'
                    >
                      <Expand className='size-[14px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>{t('see_preview')}</Tooltip.Content>
                </Tooltip.Root>
              </>
            ) : (
              <div className='flex h-full items-center justify-center text-[var(--text-placeholder)] text-small'>
                {t('deploy_your_workflow_to_see_a')}
              </div>
            )}
          </div>
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
            {t('versions')}
          </Label>
          <Versions
            workflowId={workflowId}
            versions={versions}
            versionsLoading={versionsLoading}
            isPromotingVersion={isPromotingVersion}
            selectedVersion={selectedVersion}
            onSelectVersion={handleSelectVersion}
            onPromoteToLive={handlePromoteToLive}
            onLoadDeployment={handleLoadDeployment}
          />
        </div>
      </div>

      <ChipConfirmModal
        open={showLoadDialog}
        onOpenChange={setShowLoadDialog}
        srTitle='Load Deployment'
        title={t('load_deployment')}
        text={[
          'Are you sure you want to load ',
          {
            text: versionToLoadInfo
              ? formatVersionLabel(versionToLoadInfo.version, versionToLoadInfo.name)
              : `v${versionToLoad?.version}`,
            bold: true,
          },
          '? ',
          {
            text: 'This will replace your current workflow with the deployed version.',
            error: true,
          },
        ]}
        confirm={{
          label: 'Load deployment',
          onClick: confirmLoadDeployment,
          pending: revertMutation.isPending,
        }}
      />

      <ChipConfirmModal
        open={showPromoteDialog}
        onOpenChange={setShowPromoteDialog}
        srTitle='Promote to live'
        title={t('promote_to_live')}
        text={[
          'Are you sure you want to promote ',
          {
            text: versionToPromoteInfo
              ? formatVersionLabel(versionToPromoteInfo.version, versionToPromoteInfo.name)
              : `v${versionToPromote?.version}`,
            bold: true,
          },
          ' to live? This version will become the active deployment and serve all API requests.',
        ]}
        confirm={{
          label: 'Promote to live',
          onClick: confirmPromoteToLive,
          variant: 'primary',
          pending: isPromotingVersion,
        }}
      />

      {workflowToShow && (
        <Modal open={showExpandedPreview} onOpenChange={setShowExpandedPreview}>
          <ModalContent size='full' className='flex h-[90vh] flex-col'>
            <ModalHeader>
              {previewMode === 'selected' && selectedVersionInfo
                ? formatVersionLabel(selectedVersionInfo.version, selectedVersionInfo.name)
                : 'Live Workflow'}
            </ModalHeader>
            <ModalBody className='!p-0 min-h-0 flex-1 overflow-hidden'>
              <ModalDescription className='sr-only'>
                {t('visual_preview_of_the_selected_workflow')}
              </ModalDescription>
              <Preview workflowState={workflowToShow} autoSelectLeftmost />
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </>
  )
}
