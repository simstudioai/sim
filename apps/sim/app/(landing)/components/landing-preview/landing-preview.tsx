'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, domAnimation, LazyMotion, m, type Variants } from 'framer-motion'
import { LandingPreviewChat } from '@/app/(landing)/components/landing-preview/components/landing-preview-chat/landing-preview-chat'
import { LandingPreviewFiles } from '@/app/(landing)/components/landing-preview/components/landing-preview-files/landing-preview-files'
import { LandingPreviewHome } from '@/app/(landing)/components/landing-preview/components/landing-preview-home/landing-preview-home'
import { LandingPreviewKnowledge } from '@/app/(landing)/components/landing-preview/components/landing-preview-knowledge/landing-preview-knowledge'
import { LandingPreviewLogs } from '@/app/(landing)/components/landing-preview/components/landing-preview-logs/landing-preview-logs'
import { LandingPreviewScheduledTasks } from '@/app/(landing)/components/landing-preview/components/landing-preview-scheduled-tasks/landing-preview-scheduled-tasks'
import type { SidebarView } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewSidebar } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewStageHeader } from '@/app/(landing)/components/landing-preview/components/landing-preview-stage/landing-preview-stage-header'
import { LandingPreviewTables } from '@/app/(landing)/components/landing-preview/components/landing-preview-tables/landing-preview-tables'
import { LandingPreviewWorkflow } from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/landing-preview-workflow'
import {
  EASE_OUT,
  getViewChat,
  getWorkflowStepDuration,
  PREVIEW_WORKFLOWS,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'

/** Chat-switcher breadcrumb title per non-workflow staged view. */
const CHAT_TITLES: Partial<Record<SidebarView, string>> = {
  logs: 'Agent activity',
  tables: 'Workspace data',
  files: 'Files',
  knowledge: 'Knowledge base',
  'scheduled-tasks': 'Scheduled tasks',
}

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15 },
  },
}

const sidebarVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      x: { duration: 0.25, ease: EASE_OUT },
      opacity: { duration: 0.25, ease: EASE_OUT },
    },
  },
}

const viewTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: EASE_OUT },
} as const

interface DemoStep {
  type: 'workflow' | 'home' | 'logs'
  workflowId?: string
  duration: number
}

const WORKFLOW_MAP = new Map(PREVIEW_WORKFLOWS.map((w) => [w.id, w]))

const HOME_STEP_MS = 12000
const LOGS_STEP_MS = 5000

/** Full desktop sequence: CRM -> home -> logs -> ITSM -> support -> repeat */
const DESKTOP_STEPS: DemoStep[] = [
  {
    type: 'workflow',
    workflowId: 'wf-self-healing-crm',
    duration: getWorkflowStepDuration(WORKFLOW_MAP.get('wf-self-healing-crm')!),
  },
  { type: 'home', duration: HOME_STEP_MS },
  { type: 'logs', duration: LOGS_STEP_MS },
  {
    type: 'workflow',
    workflowId: 'wf-it-service',
    duration: getWorkflowStepDuration(WORKFLOW_MAP.get('wf-it-service')!),
  },
  {
    type: 'workflow',
    workflowId: 'wf-customer-support',
    duration: getWorkflowStepDuration(WORKFLOW_MAP.get('wf-customer-support')!),
  },
]

interface LandingPreviewProps {
  /**
   * When false, render a static snapshot: no auto-cycle, no entrance/data-flow
   * animation. Used when the preview is a faded backdrop behind an elevated
   * callout rather than the live demo.
   */
  autoplay?: boolean
  /**
   * Initial staged view for the static snapshot (`autoplay={false}`). Defaults
   * to `'workflow'`. Lets each feature stage show the platform surface that
   * matches its callout (e.g. `'logs'`, `'scheduled-tasks'`).
   */
  view?: SidebarView
  /** Initial workflow for the static snapshot. Defaults to the first preview workflow. */
  workflowId?: string
}

/**
 * Interactive workspace preview for the hero section.
 *
 * Desktop: auto-cycles CRM -> home -> logs -> ITSM -> support -> repeat.
 * Mobile: static workflow canvas (no animation, no cycling).
 * User interaction permanently stops the auto-cycle.
 *
 * Pass `autoplay={false}` to render a fully static snapshot (no cycling, no
 * animation) - for use as a background behind a feature callout.
 */
export function LandingPreview({
  autoplay = true,
  view = 'workflow',
  workflowId = PREVIEW_WORKFLOWS[0].id,
}: LandingPreviewProps) {
  const [activeView, setActiveView] = useState<SidebarView>(view)
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflowId)
  const [animationKey, setAnimationKey] = useState(0)
  const [autoTypeHome, setAutoTypeHome] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  const demoIndexRef = useRef(0)
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCycleActiveRef = useRef(true)

  const clearDemoTimer = useCallback(() => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current)
      demoTimerRef.current = null
    }
  }, [])

  const applyDemoStep = useCallback((step: DemoStep) => {
    setAutoTypeHome(false)

    if (step.type === 'workflow' && step.workflowId) {
      setActiveWorkflowId(step.workflowId)
      setActiveView('workflow')
      setAnimationKey((k) => k + 1)
    } else if (step.type === 'home') {
      setActiveView('home')
      setAutoTypeHome(true)
    } else if (step.type === 'logs') {
      setActiveView('logs')
    }
  }, [])

  const scheduleNextStep = useCallback(() => {
    if (!autoCycleActiveRef.current) return
    const steps = DESKTOP_STEPS
    const currentStep = steps[demoIndexRef.current]
    demoTimerRef.current = setTimeout(() => {
      if (!autoCycleActiveRef.current) return
      demoIndexRef.current = (demoIndexRef.current + 1) % steps.length
      applyDemoStep(steps[demoIndexRef.current])
      scheduleNextStep()
    }, currentStep.duration)
  }, [applyDemoStep])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)').matches
    setIsDesktop(desktop)
    if (!desktop) return
    if (!autoplay) return
    applyDemoStep(DESKTOP_STEPS[0])
    scheduleNextStep()
    return clearDemoTimer
  }, [applyDemoStep, scheduleNextStep, clearDemoTimer, autoplay])

  const stopAutoCycle = useCallback(() => {
    autoCycleActiveRef.current = false
    clearDemoTimer()
  }, [clearDemoTimer])

  const handleSelectWorkflow = useCallback(
    (id: string) => {
      stopAutoCycle()
      setAutoTypeHome(false)
      setActiveWorkflowId(id)
      setActiveView('workflow')
      setAnimationKey((k) => k + 1)
    },
    [stopAutoCycle]
  )

  const handleSelectHome = useCallback(() => {
    stopAutoCycle()
    setAutoTypeHome(false)
    setActiveView('home')
  }, [stopAutoCycle])

  const handleSelectNav = useCallback(
    (id: SidebarView) => {
      stopAutoCycle()
      setAutoTypeHome(false)
      setActiveView(id)
    },
    [stopAutoCycle]
  )

  const activeWorkflow =
    PREVIEW_WORKFLOWS.find((w) => w.id === activeWorkflowId) ?? PREVIEW_WORKFLOWS[0]

  const isWorkflowView = activeView === 'workflow'
  const isHomeView = activeView === 'home'
  const chatName = isWorkflowView ? activeWorkflow.name : (CHAT_TITLES[activeView] ?? 'New chat')

  /** Desktop demo motion only runs when autoplaying; otherwise a static snapshot. */
  const animated = isDesktop && autoplay

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className='flex aspect-[1116/615] w-full overflow-hidden rounded bg-[var(--surface-1)] antialiased'
        initial={animated ? 'hidden' : false}
        animate='visible'
        variants={containerVariants}
      >
        <m.div className='hidden lg:flex' variants={sidebarVariants}>
          <LandingPreviewSidebar
            workflows={PREVIEW_WORKFLOWS}
            activeWorkflowId={activeWorkflowId}
            activeView={activeView}
            onSelectWorkflow={handleSelectWorkflow}
            onSelectHome={handleSelectHome}
            onSelectNav={handleSelectNav}
          />
        </m.div>
        <div className='flex min-w-0 flex-1 flex-col py-2 pr-2 pl-2 lg:pl-0'>
          <div className='flex flex-1 overflow-hidden rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
            {isHomeView ? (
              /* Home: the chat IS the whole view - its empty "What should we get
                 done?" state, with no resource staged. */
              <div className='relative flex min-w-0 flex-1 flex-col overflow-hidden'>
                {animated ? (
                  <AnimatePresence mode='wait'>
                    <m.div
                      key={`home-${animationKey}`}
                      className='flex h-full w-full flex-col'
                      {...viewTransition}
                    >
                      <LandingPreviewHome autoType={autoTypeHome} />
                    </m.div>
                  </AnimatePresence>
                ) : (
                  <LandingPreviewHome autoType={autoTypeHome} />
                )}
              </div>
            ) : (
              /* Chat everywhere: the persistent Mothership chat pane on the left,
                 a single staged resource on the right. The chat pane stays
                 mounted as the staged resource crossfades - the chat is the
                 constant the work hangs off of. */
              <>
                <m.div className='hidden lg:flex' variants={sidebarVariants}>
                  <LandingPreviewChat
                    chat={isDesktop ? getViewChat(activeView, activeWorkflow) : null}
                    chatName={chatName}
                    animationKey={animationKey}
                  />
                </m.div>
                <div className='relative flex min-w-0 flex-1 flex-col overflow-hidden border-[var(--border-1)] border-l'>
                  {isWorkflowView && <LandingPreviewStageHeader name={activeWorkflow.name} />}
                  <div className='relative min-h-0 flex-1 overflow-hidden'>
                    {animated ? (
                      <AnimatePresence mode='wait'>
                        {activeView === 'workflow' && (
                          <m.div
                            key={`wf-${activeWorkflow.id}-${animationKey}`}
                            className='h-full w-full'
                            {...viewTransition}
                          >
                            <LandingPreviewWorkflow workflow={activeWorkflow} animate />
                          </m.div>
                        )}
                        {activeView === 'tables' && (
                          <m.div
                            key={`tables-${animationKey}`}
                            className='flex h-full w-full flex-col'
                            {...viewTransition}
                          >
                            <LandingPreviewTables />
                          </m.div>
                        )}
                        {activeView === 'files' && (
                          <m.div
                            key='files'
                            className='flex h-full w-full flex-col'
                            {...viewTransition}
                          >
                            <LandingPreviewFiles />
                          </m.div>
                        )}
                        {activeView === 'knowledge' && (
                          <m.div
                            key='knowledge'
                            className='flex h-full w-full flex-col'
                            {...viewTransition}
                          >
                            <LandingPreviewKnowledge />
                          </m.div>
                        )}
                        {activeView === 'logs' && (
                          <m.div key='logs' className='flex h-full w-full flex-col' initial={false}>
                            <LandingPreviewLogs />
                          </m.div>
                        )}
                        {activeView === 'scheduled-tasks' && (
                          <m.div
                            key='scheduled-tasks'
                            className='flex h-full w-full flex-col'
                            {...viewTransition}
                          >
                            <LandingPreviewScheduledTasks />
                          </m.div>
                        )}
                      </AnimatePresence>
                    ) : activeView === 'tables' ? (
                      <LandingPreviewTables />
                    ) : activeView === 'files' ? (
                      <LandingPreviewFiles />
                    ) : activeView === 'knowledge' ? (
                      <LandingPreviewKnowledge />
                    ) : activeView === 'logs' ? (
                      <LandingPreviewLogs />
                    ) : activeView === 'scheduled-tasks' ? (
                      <LandingPreviewScheduledTasks />
                    ) : (
                      <LandingPreviewWorkflow workflow={activeWorkflow} />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </m.div>
    </LazyMotion>
  )
}
