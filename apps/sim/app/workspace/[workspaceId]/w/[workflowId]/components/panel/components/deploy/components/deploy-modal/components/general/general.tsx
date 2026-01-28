'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Expand,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { Preview, PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview'
import { useDeploymentVersionState, useRevertToVersion } from '@/hooks/queries/workflows'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { Versions } from './components'

const logger = createLogger('GeneralDeploy')

interface GeneralDeployProps {
  workflowId: string | null
  deployedState: WorkflowState
  isLoadingDeployedState: boolean
  versions: WorkflowDeploymentVersionResponse[]
  versionsLoading: boolean
  onPromoteToLive: (version: number) => Promise<void>
  onLoadDeploymentComplete: () => void
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
  onPromoteToLive,
  onLoadDeploymentComplete,
}: GeneralDeployProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('active')
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [showExpandedPreview, setShowExpandedPreview] = useState(false)
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionToPromote, setVersionToPromote] = useState<number | null>(null)

  const selectedVersionInfo = versions.find((v) => v.version === selectedVersion)
  const versionToPromoteInfo = versions.find((v) => v.version === versionToPromote)
  const versionToLoadInfo = versions.find((v) => v.version === versionToLoad)

  const { data: selectedVersionState } = useDeploymentVersionState(workflowId, selectedVersion)

  const revertMutation = useRevertToVersion()

  useEffect(() => {
    if (selectedVersion !== null) {
      setPreviewMode('selected')
    } else {
      setPreviewMode('active')
    }
  }, [selectedVersion])

  const handleSelectVersion = useCallback((version: number | null) => {
    setSelectedVersion(version)
  }, [])

  const handleLoadDeployment = useCallback((version: number) => {
    setVersionToLoad(version)
    setShowLoadDialog(true)
  }, [])

  const handlePromoteToLive = useCallback((version: number) => {
    setVersionToPromote(version)
    setShowPromoteDialog(true)
  }, [])

  const confirmLoadDeployment = async () => {
    if (!workflowId || versionToLoad === null) return

    setShowLoadDialog(false)
    const version = versionToLoad
    setVersionToLoad(null)

    try {
      await revertMutation.mutateAsync({ workflowId, version })
      onLoadDeploymentComplete()
    } catch (error) {
      logger.error('Failed to load deployment:', error)
    }
  }

  const confirmPromoteToLive = async () => {
    if (versionToPromote === null) return

    setShowPromoteDialog(false)
    const version = versionToPromote
    setVersionToPromote(null)

    try {
      await onPromoteToLive(version)
    } catch (error) {
      logger.error('Failed to promote version:', error)
    }
  }

  const workflowToShow = useMemo(() => {
    if (previewMode === 'selected' && selectedVersionState) {
      return selectedVersionState
    }
    return deployedState
  }, [previewMode, selectedVersionState, deployedState])

  const showToggle = selectedVersion !== null && deployedState

  const hasDeployedData = deployedState && Object.keys(deployedState.blocks || {}).length > 0
  const showLoadingSkeleton = isLoadingDeployedState && !hasDeployedData

  if (showLoadingSkeleton) {
    return (
      <div className='space-y-[12px]'>
        <div>
          <div className='relative mb-[6.5px]'>
            <Skeleton className='h-[16px] w-[90px]' />
          </div>
          <div className='h-[260px] w-full overflow-hidden rounded-[4px] border border-[var(--border)]'>
            <Skeleton className='h-full w-full rounded-none' />
          </div>
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[60px]' />
          <div className='h-[120px] w-full overflow-hidden rounded-[4px] border border-[var(--border)]'>
            <Skeleton className='h-full w-full rounded-none' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className='space-y-[12px]'>
        <div>
          <div className='relative mb-[6.5px]'>
            <Label className='block truncate pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              {previewMode === 'selected' && selectedVersionInfo
                ? selectedVersionInfo.name || `v${selectedVersion}`
                : 'Live Workflow'}
            </Label>
            <div
              className='absolute top-[-5px] right-0'
              style={{ visibility: showToggle ? 'visible' : 'hidden' }}
            >
              <ButtonGroup
                value={previewMode}
                onValueChange={(val) => setPreviewMode(val as PreviewMode)}
              >
                <ButtonGroupItem value='active'>Live</ButtonGroupItem>
                <ButtonGroupItem value='selected' className='truncate'>
                  {selectedVersionInfo?.name || `v${selectedVersion}`}
                </ButtonGroupItem>
              </ButtonGroup>
            </div>
          </div>

          <div
            className='relative h-[260px] w-full overflow-hidden rounded-[4px] border border-[var(--border)]'
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
                      className='absolute right-[8px] bottom-[8px] z-10 h-[28px] w-[28px] cursor-pointer border border-[var(--border)] bg-transparent p-0 backdrop-blur-sm hover:bg-[var(--surface-3)]'
                    >
                      <Expand className='h-[14px] w-[14px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>See preview</Tooltip.Content>
                </Tooltip.Root>
              </>
            ) : (
              <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[13px]'>
                Deploy your workflow to see a preview
              </div>
            )}
          </div>
        </div>

        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Versions
          </Label>
          <Versions
            workflowId={workflowId}
            versions={versions}
            versionsLoading={versionsLoading}
            selectedVersion={selectedVersion}
            onSelectVersion={handleSelectVersion}
            onPromoteToLive={handlePromoteToLive}
            onLoadDeployment={handleLoadDeployment}
          />
        </div>
      </div>

      <Modal open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Load Deployment</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
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

      <Modal open={showPromoteDialog} onOpenChange={setShowPromoteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Promote to live</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
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

      {workflowToShow && (
        <Modal open={showExpandedPreview} onOpenChange={setShowExpandedPreview}>
          <ModalContent size='full' className='flex h-[90vh] flex-col'>
            <ModalHeader>
              {previewMode === 'selected' && selectedVersionInfo
                ? selectedVersionInfo.name || `v${selectedVersion}`
                : 'Live Workflow'}
            </ModalHeader>
            <ModalBody className='!p-0 min-h-0 flex-1 overflow-hidden'>
              <Preview workflowState={workflowToShow} autoSelectLeftmost />
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </>
  )
}
