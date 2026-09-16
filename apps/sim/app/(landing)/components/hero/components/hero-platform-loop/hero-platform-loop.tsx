'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import {
  HeroChatLoop,
  type HeroChatPhase,
} from '@/app/(landing)/components/hero/components/hero-chat-loop'
import { HeroPlatformIntro } from '@/app/(landing)/components/hero/components/hero-platform-intro'
import {
  type HeroResourceId,
  HeroResourcePanel,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-resource-panel'
import { PREVIEW_BUILD_TIMING } from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-build-timing'
import {
  DEFAULT_REPLY_MESSAGE,
  DEFAULT_USER_MESSAGE,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-chat-content'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import {
  PREVIEW_SIDEBAR_CHATS,
  PREVIEW_SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/components/shared/sidebar-preview-content'
import { useDragResize } from '@/hooks/use-drag-resize'

const REPLY_AT =
  PREVIEW_BUILD_TIMING.blockStartAt +
  STAGE_BLOCKS.length * PREVIEW_BUILD_TIMING.blockStepMs +
  PREVIEW_BUILD_TIMING.replyPauseMs
const PROMPT_START_DELAY = 400
const PROMPT_CHAR_MS = 24
const PROMPT_HOLD_MS = 500
const RESOURCE_RUN_STEP = 360
const PREVIEW_PANE_MIN_WIDTH = 360

/**
 * Native-scale product preview for the homepage. It composes the real Sim
 * sidebar geometry, chat controls, resource tab strip, and embedded workflow
 * presentation with isolated demo state, so visitors can use the preview
 * without a session or access to workspace data.
 */
export function HeroPlatformLoop() {
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const resourcePaneRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<HeroChatPhase>('idle')
  const [stageOpen, setStageOpen] = useState(false)
  const [isResizingStage, setIsResizingStage] = useState(false)
  const [builtCount, setBuiltCount] = useState(0)
  const [cycleId, setCycleId] = useState(0)
  const [submissionId, setSubmissionId] = useState(0)
  const [resourceRunId, setResourceRunId] = useState(0)
  const [composerValue, setComposerValue] = useState('')
  const [userMessage, setUserMessage] = useState(DEFAULT_USER_MESSAGE)
  const [activeResourceId, setActiveResourceId] = useState<HeroResourceId | null>('workflow')
  const [openResourceIds, setOpenResourceIds] = useState<HeroResourceId[]>(['workflow', 'table'])

  const finishIntro = useCallback((reducedMotion: boolean) => {
    if (reducedMotion) {
      setPhase('reply')
      setStageOpen(true)
      setBuiltCount(STAGE_BLOCKS.length)
      return
    }
    setPhase('compose')
  }, [])

  const { handlePointerDown: handleStageResizePointerDown } = useDragResize({
    cursor: 'ew-resize',
    cssVar: '--preview-resource-width',
    getTarget: () => resourcePaneRef.current,
    compute: (event) => {
      const container = previewContainerRef.current
      if (!container) return null

      const rect = container.getBoundingClientRect()
      const minWidth = Math.min(PREVIEW_PANE_MIN_WIDTH, rect.width / 2)
      const maxWidth = Math.max(minWidth, rect.width - minWidth)
      return Math.min(Math.max(rect.right - event.clientX, minWidth), maxWidth)
    },
    commit: (width) => {
      previewContainerRef.current?.style.setProperty('--preview-resource-width', `${width}px`)
    },
    onStart: () => {
      resourcePaneRef.current?.style.setProperty('transition', 'none')
      setIsResizingStage(true)
    },
    onEnd: () => {
      resourcePaneRef.current?.style.removeProperty('transition')
      setIsResizingStage(false)
    },
  })

  useEffect(() => {
    if (phase !== 'compose') return undefined

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const startedAt = performance.now()
    const sendAt =
      PROMPT_START_DELAY + DEFAULT_USER_MESSAGE.length * PROMPT_CHAR_MS + PROMPT_HOLD_MS
    const interval = setInterval(() => {
      const elapsed = performance.now() - startedAt
      const count = Math.max(0, Math.floor((elapsed - PROMPT_START_DELAY) / PROMPT_CHAR_MS))
      setComposerValue(DEFAULT_USER_MESSAGE.slice(0, count))
      if (elapsed < sendAt) return
      clearInterval(interval)
      setComposerValue('')
      setPhase('user')
      setSubmissionId((current) => current + 1)
    }, PROMPT_CHAR_MS)

    const syncMotionPreference = () => {
      if (!media.matches) return
      clearInterval(interval)
      setComposerValue('')
      setPhase('reply')
      setStageOpen(true)
      setBuiltCount(STAGE_BLOCKS.length)
    }
    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      clearInterval(interval)
      media.removeEventListener('change', syncMotionPreference)
    }
  }, [phase])

  useEffect(() => {
    if (submissionId === 0) return undefined

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timers: ReturnType<typeof setTimeout>[] = []
    const settle = () => {
      timers.forEach(clearTimeout)
      setStageOpen(true)
      setBuiltCount(STAGE_BLOCKS.length)
      setPhase('reply')
    }
    const syncMotionPreference = () => {
      if (media.matches) settle()
    }
    if (media.matches) {
      settle()
      return undefined
    }

    timers.push(
      setTimeout(() => setPhase('thinking'), PREVIEW_BUILD_TIMING.thinkingAt),
      setTimeout(() => setPhase('dispatching'), PREVIEW_BUILD_TIMING.dispatchAt),
      setTimeout(() => setPhase('building'), PREVIEW_BUILD_TIMING.agentAt),
      setTimeout(() => setStageOpen(true), PREVIEW_BUILD_TIMING.stageOpenAt),
      ...STAGE_BLOCKS.map((_, index) =>
        setTimeout(
          () => setBuiltCount(index + 1),
          PREVIEW_BUILD_TIMING.blockStartAt + index * PREVIEW_BUILD_TIMING.blockStepMs
        )
      ),
      setTimeout(() => setPhase('reply'), REPLY_AT)
    )
    media.addEventListener('change', syncMotionPreference)
    return () => {
      timers.forEach(clearTimeout)
      media.removeEventListener('change', syncMotionPreference)
    }
  }, [submissionId])

  useEffect(() => {
    if (resourceRunId === 0) return undefined

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timers: ReturnType<typeof setTimeout>[] = []
    const settle = () => {
      timers.forEach(clearTimeout)
      setBuiltCount(STAGE_BLOCKS.length)
    }
    const syncMotionPreference = () => {
      if (media.matches) settle()
    }
    if (media.matches) {
      settle()
      return undefined
    }

    timers.push(
      ...STAGE_BLOCKS.map((_, index) =>
        setTimeout(() => setBuiltCount(index + 1), index * RESOURCE_RUN_STEP)
      )
    )
    media.addEventListener('change', syncMotionPreference)
    return () => {
      timers.forEach(clearTimeout)
      media.removeEventListener('change', syncMotionPreference)
    }
  }, [resourceRunId])

  const pausePrompt = () => {
    if (phase === 'compose') setPhase('idle')
  }

  const updateComposer = (value: string) => {
    pausePrompt()
    setComposerValue(value)
  }

  const openResource = (id: HeroResourceId) => {
    setOpenResourceIds((current) => (current.includes(id) ? current : [...current, id]))
    setActiveResourceId(id)
    setStageOpen(true)
  }

  const closeResource = (id: HeroResourceId) => {
    const index = openResourceIds.indexOf(id)
    if (index < 0) return

    const next = openResourceIds.filter((resourceId) => resourceId !== id)
    setOpenResourceIds(next)
    if (activeResourceId === id) {
      setActiveResourceId(next[Math.min(index, next.length - 1)] ?? null)
    }
  }

  const submitMessage = (messageOverride?: string) => {
    const message = (messageOverride ?? composerValue).trim()
    if (!message) return

    setUserMessage(message)
    setComposerValue('')
    setPhase('user')
    setStageOpen(false)
    setBuiltCount(0)
    setResourceRunId(0)
    setActiveResourceId('workflow')
    setOpenResourceIds((current) =>
      current.includes('workflow') ? current : [...current, 'workflow']
    )
    setCycleId((current) => current + 1)
    setSubmissionId((current) => current + 1)
  }

  const stopGeneration = () => {
    setPhase('reply')
    openResource('workflow')
    setBuiltCount(STAGE_BLOCKS.length)
    setSubmissionId(0)
    setResourceRunId(0)
  }

  const runWorkflow = () => {
    openResource('workflow')
    setPhase('reply')
    setSubmissionId(0)
    setBuiltCount(0)
    setCycleId((current) => current + 1)
    setResourceRunId((current) => current + 1)
  }

  const isSending = phase !== 'idle' && phase !== 'compose' && phase !== 'reply'

  return (
    <HeroPlatformIntro onComplete={finishIntro}>
      <HeroLoopShell
        chats={PREVIEW_SIDEBAR_CHATS}
        workflows={PREVIEW_SIDEBAR_WORKFLOWS}
        mode='native'
      >
        <div
          ref={previewContainerRef}
          className='relative flex h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)] [--preview-resource-width:50%]'
        >
          <div className={cn('relative h-full min-w-0 flex-1', stageOpen && 'max-lg:hidden')}>
            <HeroChatLoop
              showWelcome
              phase={phase}
              fading={false}
              userMessage={userMessage}
              replyMessage={DEFAULT_REPLY_MESSAGE}
              composerValue={composerValue}
              isSending={isSending}
              onComposerValueChange={updateComposer}
              onComposerFocus={pausePrompt}
              onOpenWorkflowResource={() => openResource('workflow')}
              onFollowUpSelect={submitMessage}
              onSubmit={() => submitMessage()}
              onStopGeneration={stopGeneration}
            />
            {!stageOpen && (
              <div className='absolute top-2 right-3 z-30'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size={null}
                      onClick={() => openResource(activeResourceId ?? 'workflow')}
                      className='size-[30px] rounded-[8px] p-0 hover-hover:bg-[var(--surface-active)]'
                      aria-label='Expand resource view'
                    >
                      <PanelLeft className='-scale-x-100 size-[16px] text-[var(--text-icon)]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>Expand resource view</Tooltip.Content>
                </Tooltip.Root>
              </div>
            )}
          </div>

          {stageOpen && (
            <div className='relative z-20 w-0 flex-none max-lg:hidden'>
              <div
                className='absolute inset-y-0 left-[-4px] w-[8px] cursor-ew-resize touch-none hover-hover:[&>div]:bg-[var(--border)]'
                onPointerDown={handleStageResizePointerDown}
                role='separator'
                aria-orientation='vertical'
                aria-label='Resize resource panel'
              >
                <div
                  className={cn(
                    '-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 w-px bg-transparent transition-colors duration-100 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
                    isResizingStage && 'bg-[var(--border)]'
                  )}
                />
              </div>
            </div>
          )}

          <div
            ref={resourcePaneRef}
            data-resource-open={stageOpen}
            inert={!stageOpen}
            aria-hidden={!stageOpen}
            className={cn(
              'h-full shrink-0 overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-[480ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              stageOpen
                ? 'w-[var(--preview-resource-width)] border-l max-lg:w-full max-lg:border-l-0'
                : 'w-0 min-w-0 border-l-0'
            )}
          >
            <div
              className={cn(
                'h-full w-full transition-[transform,opacity] duration-[480ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                stageOpen ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'
              )}
            >
              <HeroResourcePanel
                activeId={activeResourceId}
                builtCount={builtCount}
                openIds={openResourceIds}
                workflowKey={cycleId}
                onActiveChange={setActiveResourceId}
                onClose={() => setStageOpen(false)}
                onCloseResource={closeResource}
                onOpenResource={openResource}
                onRunWorkflow={runWorkflow}
              />
            </div>
          </div>
        </div>
      </HeroLoopShell>
    </HeroPlatformIntro>
  )
}
