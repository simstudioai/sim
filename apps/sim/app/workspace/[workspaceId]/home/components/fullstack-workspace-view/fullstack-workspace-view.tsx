'use client'

import { forwardRef, memo, useEffect, useRef, useState } from 'react'
import { Button, ChipConfirmModal, cn, toast } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AppPreviewBridge } from '@/components/apps/preview-bridge'
import { publishAppWithDeploy } from '@/lib/apps/client'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { MothershipView } from '@/app/workspace/[workspaceId]/home/components/mothership-view'
import {
  applyFullstackAppLifecycleEvent,
  clearFullstackPreviewSession,
  type FullstackLifecycleState,
  prepareFullstackPreviewForDeploy,
  setFullstackDestination,
  useFullstackLifecycleState,
} from '@/app/workspace/[workspaceId]/home/hooks/fullstack-lifecycle-store'
import type {
  GenericResourceData,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useAppProject, useCreateAppPreviewSession } from '@/hooks/queries/apps'

const FULLSTACK_PROGRESS_STAGES = ['Backend', 'Interface', 'Build', 'Preview'] as const

function FullstackProgressSteps({ phase }: { phase: FullstackLifecycleState['phase'] }) {
  const activeIndex =
    phase === 'building_backend'
      ? 0
      : phase === 'generating_interface'
        ? 1
        : phase === 'building_app' || phase === 'updating'
          ? 2
          : phase === 'preview_ready'
            ? 3
            : 0
  return (
    <div className='mt-2 flex items-center gap-1.5' aria-label='Full-stack build progress'>
      {FULLSTACK_PROGRESS_STAGES.map((stage, index) => (
        <div
          key={stage}
          className={cn(
            'rounded-full px-2 py-1 text-[10px] transition-colors duration-300',
            index === activeIndex
              ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
              : index < activeIndex
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-muted)]'
          )}
        >
          {stage}
        </div>
      ))}
    </div>
  )
}

interface FullstackWorkspaceViewProps {
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeResourceId: string | null
  isCollapsed: boolean
  className?: string
  previewSession?: FilePreviewSession | null
  isAgentResponding?: boolean
  genericResourceData?: GenericResourceData
  projectId?: string | null
  projectName?: string | null
}

export const FullstackWorkspaceView = memo(
  forwardRef<HTMLDivElement, FullstackWorkspaceViewProps>(function FullstackWorkspaceView(
    {
      workspaceId,
      chatId,
      resources,
      activeResourceId,
      isCollapsed,
      className,
      previewSession,
      isAgentResponding,
      genericResourceData,
      projectId: projectIdProp,
      projectName,
    },
    ref
  ) {
    const router = useRouter()
    const { canAdmin } = useUserPermissionsContext()
    const lifecycle = useFullstackLifecycleState()
    const projectId = projectIdProp || lifecycle.projectId
    const detailQuery = useAppProject(projectId ?? undefined, { enabled: Boolean(projectId) })
    const createPreview = useCreateAppPreviewSession(projectId ?? '')
    const [confirmDeploy, setConfirmDeploy] = useState(false)
    const [displayedPreview, setDisplayedPreview] = useState<typeof lifecycle.preview>(null)
    const [candidatePreview, setCandidatePreview] = useState<typeof lifecycle.preview>(null)
    const [candidateError, setCandidateError] = useState<string | null>(null)
    const hydratedRevisionRef = useRef<string | null>(null)

    const destination = lifecycle.destination
    const activePreview = lifecycle.preview
    const showUpdatingOverlay =
      Boolean(
        displayedPreview &&
          (candidatePreview ||
            lifecycle.phase === 'updating' ||
            lifecycle.phase === 'generating_interface' ||
            lifecycle.phase === 'building_app')
      ) && destination === 'preview'
    const showGenerating =
      destination === 'preview' &&
      !activePreview &&
      (lifecycle.phase === 'generating_interface' ||
        lifecycle.phase === 'building_app' ||
        lifecycle.phase === 'updating')

    // Auto-focus backend while workflows stream in.
    useEffect(() => {
      if (isAgentResponding && lifecycle.phase === 'building_backend') {
        setFullstackDestination('backend')
      }
    }, [isAgentResponding, lifecycle.phase])

    const publicUrl = detailQuery.data?.publicUrl ?? null

    const displayName =
      projectName || detailQuery.data?.project.name || lifecycle.projectId || 'Full-stack App'

    useEffect(() => {
      if (displayedPreview && projectId && displayedPreview.projectId !== projectId) {
        setDisplayedPreview(null)
        setCandidatePreview(null)
      }
    }, [displayedPreview, projectId])

    useEffect(() => {
      if (!activePreview) return
      hydratedRevisionRef.current = activePreview.revisionId
      if (
        displayedPreview?.projectId !== activePreview.projectId ||
        displayedPreview.sessionId !== activePreview.sessionId
      ) {
        setCandidateError(null)
        setCandidatePreview(activePreview)
      }
    }, [activePreview, displayedPreview])

    useEffect(() => {
      const project = detailQuery.data?.project
      const latestBuild = detailQuery.data?.latestBuild
      if (
        !projectId ||
        !project?.draftRevisionId ||
        latestBuild?.status !== 'succeeded' ||
        latestBuild.revisionId !== project.draftRevisionId ||
        activePreview ||
        createPreview.isPending ||
        hydratedRevisionRef.current === project.draftRevisionId
      ) {
        return
      }
      hydratedRevisionRef.current = project.draftRevisionId
      void createPreview
        .mutateAsync({ revisionId: project.draftRevisionId })
        .then((result) => {
          applyFullstackAppLifecycleEvent({
            eventName: 'app.preview.ready',
            chatId,
            payload: {
              projectId,
              revisionId: project.draftRevisionId,
              buildId: result.buildId,
              sessionId: result.sessionId,
              channelNonce: result.channelNonce,
              appPublicOrigin: result.appPublicOrigin,
              artifactPreview: result.artifactPreview,
            },
          })
        })
        .catch((error) => {
          applyFullstackAppLifecycleEvent({
            eventName: 'app.generation.failed',
            chatId,
            payload: {
              projectId,
              message: error instanceof Error ? error.message : 'Failed to restore App preview',
            },
          })
        })
    }, [
      activePreview,
      chatId,
      createPreview,
      detailQuery.data?.latestBuild,
      detailQuery.data?.project,
      projectId,
    ])

    async function handleDeploy() {
      if (!projectId || !canAdmin) return
      setConfirmDeploy(false)
      applyFullstackAppLifecycleEvent({
        eventName: 'app.deploy.started',
        chatId,
        payload: { projectId },
      })
      prepareFullstackPreviewForDeploy()
      try {
        const result = await publishAppWithDeploy({
          projectId,
          expectedVersion: detailQuery.data?.project.version,
        })
        applyFullstackAppLifecycleEvent({
          eventName: 'app.release.published',
          chatId,
          payload: { projectId, releaseId: result.releaseId },
        })
        toast({
          message: `Published with ${result.deployments.length} workflow deploy(s)`,
        })
        void detailQuery.refetch()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Deploy failed'
        applyFullstackAppLifecycleEvent({
          eventName: 'app.deploy.failed',
          chatId,
          payload: { projectId, message },
        })
        toast({ message, variant: 'error' })
      }
    }

    function handlePreviewFailure(sessionId: string, message: string) {
      setCandidateError(message)
      clearFullstackPreviewSession(sessionId)
    }

    function retryWithFreshPreview() {
      const staleSessionId = candidatePreview?.sessionId || displayedPreview?.sessionId
      if (staleSessionId) clearFullstackPreviewSession(staleSessionId)
      hydratedRevisionRef.current = null
      setCandidatePreview(null)
      setCandidateError(null)
    }

    return (
      <div
        ref={ref}
        className={cn(
          'relative z-10 flex h-full flex-col overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
          isCollapsed ? 'w-0 min-w-0 border-l-0' : 'w-1/2 border-l',
          className
        )}
      >
        <header className='flex shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b px-3 py-2'>
          <div className='min-w-0'>
            <p className='truncate font-medium text-[var(--text-primary)] text-sm'>{displayName}</p>
            <p className='truncate text-[var(--text-tertiary)] text-xs'>
              {lifecycle.statusMessage ||
                (lifecycle.phase === 'preview_ready'
                  ? 'Live preview'
                  : lifecycle.phase === 'building_backend'
                    ? 'Building backend…'
                    : 'Full-stack workspace')}
              {lifecycle.deployStatus === 'deploying' ? ' · Deploying…' : null}
              {lifecycle.deployStatus === 'deployed' ? ' · Published' : null}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            <div
              role='group'
              aria-label='Full-stack panel'
              className='flex rounded-md border border-[var(--border)] p-0.5 text-xs'
            >
              <button
                type='button'
                aria-pressed={destination === 'backend'}
                className={cn(
                  'rounded px-2 py-1',
                  destination === 'backend' ? 'bg-[var(--surface-2)]' : 'opacity-60'
                )}
                onClick={() => setFullstackDestination('backend')}
              >
                Backend
              </button>
              <button
                type='button'
                aria-pressed={destination === 'preview'}
                className={cn(
                  'rounded px-2 py-1',
                  destination === 'preview' ? 'bg-[var(--surface-2)]' : 'opacity-60'
                )}
                onClick={() => setFullstackDestination('preview')}
              >
                Preview
              </button>
            </div>
            {publicUrl ? (
              <Button
                type='button'
                variant='ghost'
                size={null}
                className='size-[30px] rounded-[8px]'
                aria-label='Open public App'
                onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className='size-[14px]' />
              </Button>
            ) : null}
            {projectId ? (
              <Button
                type='button'
                variant='ghost'
                className='text-xs'
                onClick={() => router.push(`/workspace/${workspaceId}/apps/${projectId}`)}
              >
                Advanced
              </Button>
            ) : null}
            <Button
              type='button'
              variant='default'
              disabled={!canAdmin || !projectId || lifecycle.deployStatus === 'deploying'}
              onClick={() => setConfirmDeploy(true)}
            >
              {lifecycle.deployStatus === 'deploying' ? 'Deploying…' : 'Deploy'}
            </Button>
          </div>
        </header>

        <div className='relative min-h-0 flex-1'>
          <div className={cn('h-full', destination === 'backend' ? 'block' : 'hidden')}>
            {resources.length > 0 ? (
              <MothershipView
                workspaceId={workspaceId}
                chatId={chatId}
                resources={resources}
                activeResourceId={activeResourceId}
                isCollapsed={false}
                previewSession={previewSession}
                isAgentResponding={isAgentResponding}
                genericResourceData={genericResourceData}
                className='!w-full !min-w-0 !border-l-0'
              />
            ) : (
              <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
                {lifecycle.phase === 'building_backend' ? (
                  <Loader animate className='size-5' />
                ) : null}
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  {lifecycle.phase === 'building_backend'
                    ? 'Building backend workflows…'
                    : lifecycle.phase === 'credential_selection_required'
                      ? 'Waiting for account selection'
                      : 'Backend workflows will appear here'}
                </p>
                <p className='max-w-sm text-[var(--text-tertiary)] text-xs'>
                  {lifecycle.phase === 'building_backend'
                    ? 'Workflow tabs will open automatically as the backend builder creates them.'
                    : 'Describe your app in chat to start building.'}
                </p>
                {lifecycle.phase === 'building_backend' ? (
                  <FullstackProgressSteps phase={lifecycle.phase} />
                ) : null}
              </div>
            )}
          </div>

          <div className={cn('relative h-full', destination === 'preview' ? 'block' : 'hidden')}>
            {displayedPreview ? (
              <AppPreviewBridge
                projectId={displayedPreview.projectId}
                sessionId={displayedPreview.sessionId}
                channelNonce={displayedPreview.channelNonce}
                previewSrc={displayedPreview.previewSrc}
                onFailure={(message) => handlePreviewFailure(displayedPreview.sessionId, message)}
                onSessionStopped={clearFullstackPreviewSession}
              />
            ) : showGenerating || candidatePreview ? (
              <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
                <Loader animate className='size-5' />
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  {candidatePreview ? 'Opening live preview…' : 'Generating interface…'}
                </p>
                <p className='max-w-sm text-[var(--text-tertiary)] text-xs'>
                  The live preview will open automatically when the build finishes.
                </p>
                <FullstackProgressSteps phase={lifecycle.phase} />
              </div>
            ) : (
              <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Preview will appear here
                </p>
                <p className='max-w-sm text-[var(--text-tertiary)] text-xs'>
                  Backend workflows stream on the Backend tab first. After handoff, the interface
                  builds and mounts automatically.
                </p>
              </div>
            )}

            {candidatePreview ? (
              <div className='pointer-events-none absolute inset-0 opacity-0'>
                <AppPreviewBridge
                  key={candidatePreview.sessionId}
                  projectId={candidatePreview.projectId}
                  sessionId={candidatePreview.sessionId}
                  channelNonce={candidatePreview.channelNonce}
                  previewSrc={candidatePreview.previewSrc}
                  onReady={() => {
                    setDisplayedPreview(candidatePreview)
                    setCandidatePreview(null)
                    setCandidateError(null)
                  }}
                  onFailure={(message) => handlePreviewFailure(candidatePreview.sessionId, message)}
                  onSessionStopped={clearFullstackPreviewSession}
                />
              </div>
            ) : null}

            {displayedPreview?.artifactPreview === false ? (
              <div className='absolute right-3 bottom-3 left-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--text-secondary)] text-xs'>
                Dev diagnostic preview: the action bridge is available, but this build does not
                contain a real Vite artifact. Open Advanced to configure a local Vite or E2B build.
              </div>
            ) : null}

            {showUpdatingOverlay ? (
              <div className='absolute inset-0 flex items-start justify-center bg-[var(--bg)]/40 pt-4 backdrop-blur-[1px]'>
                <div className='flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] text-xs shadow-sm'>
                  {candidateError ? (
                    <>
                      <span>{candidateError}</span>
                      <Button
                        type='button'
                        variant='ghost'
                        className='h-6 px-2 text-xs'
                        onClick={() => {
                          retryWithFreshPreview()
                        }}
                      >
                        Retry
                      </Button>
                    </>
                  ) : (
                    <>
                      <Loader animate className='size-3.5' />
                      Updating…
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <ChipConfirmModal
          open={confirmDeploy}
          onOpenChange={setConfirmDeploy}
          title='Deploy public App?'
          text='This deploys every draft workflow, rebinds actions, rebuilds the same source, and publishes the release pointer atomically. The model cannot publish without your confirmation.'
          confirm={{
            label: 'Deploy',
            onClick: () => void handleDeploy(),
            pending: lifecycle.deployStatus === 'deploying',
            pendingLabel: 'Deploying…',
          }}
        />
      </div>
    )
  })
)
