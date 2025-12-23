'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
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
  fetchVersions: () => Promise<void>
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
  fetchVersions,
}: GeneralDeployProps) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('active')
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionToPromote, setVersionToPromote] = useState<number | null>(null)

  const versionCacheRef = useRef<Map<number, WorkflowState>>(new Map())
  const [, forceUpdate] = useState({})

  const selectedVersionInfo = versions.find((v) => v.version === selectedVersion)
  const versionToPromoteInfo = versions.find((v) => v.version === versionToPromote)
  const versionToLoadInfo = versions.find((v) => v.version === versionToLoad)

  const cachedSelectedState =
    selectedVersion !== null ? versionCacheRef.current.get(selectedVersion) : null

  const fetchSelectedVersionState = useCallback(
    async (version: number) => {
      if (!workflowId) return
      if (versionCacheRef.current.has(version)) return

      try {
        const res = await fetch(`/api/workflows/${workflowId}/deployments/${version}`)
        if (res.ok) {
          const data = await res.json()
          if (data.deployedState) {
            versionCacheRef.current.set(version, data.deployedState)
            forceUpdate({})
          }
        }
      } catch (error) {
        logger.error('Error fetching version state:', error)
      }
    },
    [workflowId]
  )

  useEffect(() => {
    if (selectedVersion !== null) {
      fetchSelectedVersionState(selectedVersion)
      setPreviewMode('selected')
    } else {
      setPreviewMode('active')
    }
  }, [selectedVersion, fetchSelectedVersionState])

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

    // Close modal immediately for snappy UX
    setShowLoadDialog(false)
    const version = versionToLoad
    setVersionToLoad(null)

    try {
      const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}/revert`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to load deployment')
      }

      onLoadDeploymentComplete()
    } catch (error) {
      logger.error('Failed to load deployment:', error)
    }
  }

  const confirmPromoteToLive = async () => {
    if (versionToPromote === null) return

    // Close modal immediately for snappy UX
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
    if (previewMode === 'selected' && cachedSelectedState) {
      return cachedSelectedState
    }
    return deployedState
  }, [previewMode, cachedSelectedState, deployedState])

  const showToggle = selectedVersion !== null && deployedState

  // Only show skeleton on initial load when we have no deployed data
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
              className='absolute top-[-5px] right-0 inline-flex gap-[2px]'
              style={{ visibility: showToggle ? 'visible' : 'hidden' }}
            >
              <Button
                type='button'
                variant={previewMode === 'active' ? 'active' : 'default'}
                onClick={() => setPreviewMode('active')}
                className='rounded-r-none px-[8px] py-[4px] text-[12px]'
              >
                Live
              </Button>
              <Button
                type='button'
                variant={previewMode === 'selected' ? 'active' : 'default'}
                onClick={() => setPreviewMode('selected')}
                className='truncate rounded-l-none px-[8px] py-[4px] text-[12px]'
              >
                {selectedVersionInfo?.name || `v${selectedVersion}`}
              </Button>
            </div>
          </div>

          <div
            className='[&_*]:!cursor-default relative h-[260px] w-full cursor-default overflow-hidden rounded-[4px] border border-[var(--border)]'
            onWheelCapture={(e) => {
              if (e.ctrlKey || e.metaKey) return
              e.stopPropagation()
            }}
          >
            {workflowToShow ? (
              <WorkflowPreview
                workflowState={workflowToShow}
                showSubBlocks={true}
                height='100%'
                width='100%'
                isPannable={true}
                defaultPosition={{ x: 0, y: 0 }}
                defaultZoom={0.6}
              />
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
            fetchVersions={fetchVersions}
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
            <p className='text-[12px] text-[var(--text-tertiary)]'>
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
    </>
  )
}
