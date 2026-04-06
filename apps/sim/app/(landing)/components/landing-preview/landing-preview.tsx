'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { LandingPreviewFiles } from '@/app/(landing)/components/landing-preview/components/landing-preview-files/landing-preview-files'
import { LandingPreviewHome } from '@/app/(landing)/components/landing-preview/components/landing-preview-home/landing-preview-home'
import { LandingPreviewKnowledge } from '@/app/(landing)/components/landing-preview/components/landing-preview-knowledge/landing-preview-knowledge'
import { LandingPreviewLogs } from '@/app/(landing)/components/landing-preview/components/landing-preview-logs/landing-preview-logs'
import { LandingPreviewPanel } from '@/app/(landing)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { LandingPreviewScheduledTasks } from '@/app/(landing)/components/landing-preview/components/landing-preview-scheduled-tasks/landing-preview-scheduled-tasks'
import type { SidebarView } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewSidebar } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewTables } from '@/app/(landing)/components/landing-preview/components/landing-preview-tables/landing-preview-tables'
import { LandingPreviewWorkflow } from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/landing-preview-workflow'
import {
  EASE_OUT,
  getWorkflowStepDuration,
  PREVIEW_WORKFLOWS,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'

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

const panelVariants: Variants = {
  hidden: { opacity: 0, x: 12 },
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
  type: 'workflow' | 'tables' | 'home' | 'logs'
  workflowId?: string
  tableId?: string
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

/**
 * Interactive workspace preview for the hero section.
 *
 * Desktop: auto-cycles CRM -> home -> logs -> ITSM -> support -> repeat.
 * Mobile: static workflow canvas (no animation, no cycling).
 * User interaction permanently stops the auto-cycle.
 */
export function LandingPreview() {
  const [activeView, setActiveView] = useState<SidebarView>('workflow')
  const [activeWorkflowId, setActiveWorkflowId] = useState(PREVIEW_WORKFLOWS[0].id)
  const animationKeyRef = useRef(0)
  const [animationKey, setAnimationKey] = useState(0)
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null)
  const [autoTableId, setAutoTableId] = useState<string | null>(null)
  const [autoTypeHome, setAutoTypeHome] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  const demoIndexRef = useRef(0)
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCycleActiveRef = useRef(true)
  const isDesktopRef = useRef(true)

  const clearDemoTimer = useCallback(() => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current)
      demoTimerRef.current = null
    }
  }, [])

  const applyDemoStep = useCallback((step: DemoStep) => {
    setAutoTableId(null)
    setAutoTypeHome(false)

    if (step.type === 'workflow' && step.workflowId) {
      setActiveWorkflowId(step.workflowId)
      setActiveView('workflow')
      animationKeyRef.current += 1
      setAnimationKey(animationKeyRef.current)
    } else if (step.type === 'tables') {
      setActiveView('tables')
      setAutoTableId(step.tableId ?? null)
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
    isDesktopRef.current = desktop
    setIsDesktop(desktop)
    if (!desktop) return
    applyDemoStep(DESKTOP_STEPS[0])
    scheduleNextStep()
    return clearDemoTimer
  }, [applyDemoStep, scheduleNextStep, clearDemoTimer])

  const stopAutoCycle = useCallback(() => {
    autoCycleActiveRef.current = false
    clearDemoTimer()
  }, [clearDemoTimer])

  const handleSelectWorkflow = useCallback(
    (id: string) => {
      stopAutoCycle()
      setAutoTableId(null)
      setAutoTypeHome(false)
      setHighlightedBlockId(null)
      setActiveWorkflowId(id)
      setActiveView('workflow')
      animationKeyRef.current += 1
      setAnimationKey(animationKeyRef.current)
    },
    [stopAutoCycle]
  )

  const handleSelectHome = useCallback(() => {
    stopAutoCycle()
    setAutoTableId(null)
    setAutoTypeHome(false)
    setHighlightedBlockId(null)
    setActiveView('home')
  }, [stopAutoCycle])

  const handleSelectNav = useCallback(
    (id: SidebarView) => {
      stopAutoCycle()
      setAutoTableId(null)
      setAutoTypeHome(false)
      setHighlightedBlockId(null)
      setActiveView(id)
    },
    [stopAutoCycle]
  )

  const handleHighlightBlock = useCallback((blockId: string | null) => {
    setHighlightedBlockId(blockId)
  }, [])

  const activeWorkflow =
    PREVIEW_WORKFLOWS.find((w) => w.id === activeWorkflowId) ?? PREVIEW_WORKFLOWS[0]

  const isWorkflowView = activeView === 'workflow'

  return (
    <motion.div
      className='dark flex aspect-[1116/615] w-full overflow-hidden rounded bg-[var(--landing-bg-surface)] antialiased'
      initial={isDesktop ? 'hidden' : false}
      animate='visible'
      variants={containerVariants}
    >
      <motion.div className='hidden lg:flex' variants={sidebarVariants}>
        <LandingPreviewSidebar
          workflows={PREVIEW_WORKFLOWS}
          activeWorkflowId={activeWorkflowId}
          activeView={activeView}
          onSelectWorkflow={handleSelectWorkflow}
          onSelectHome={handleSelectHome}
          onSelectNav={handleSelectNav}
        />
      </motion.div>
      <div className='flex min-w-0 flex-1 flex-col py-2 pr-2 pl-2 lg:pl-0'>
        <div className='flex flex-1 overflow-hidden rounded-[5px] border border-[#2c2c2c] bg-[var(--landing-bg)]'>
          <div
            className={
              isWorkflowView
                ? 'relative min-w-0 flex-1 overflow-hidden'
                : 'relative flex min-w-0 flex-1 flex-col overflow-hidden'
            }
          >
            {isDesktop ? (
              <AnimatePresence mode='wait'>
                {activeView === 'workflow' && (
                  <motion.div
                    key={`wf-${activeWorkflow.id}-${animationKey}`}
                    className='h-full w-full'
                    {...viewTransition}
                  >
                    <LandingPreviewWorkflow
                      workflow={activeWorkflow}
                      animate
                      highlightedBlockId={highlightedBlockId}
                    />
                  </motion.div>
                )}
                {activeView === 'home' && (
                  <motion.div
                    key={`home-${animationKey}`}
                    className='flex h-full w-full flex-col'
                    {...viewTransition}
                  >
                    <LandingPreviewHome autoType={autoTypeHome} />
                  </motion.div>
                )}
                {activeView === 'tables' && (
                  <motion.div
                    key={`tables-${animationKey}`}
                    className='flex h-full w-full flex-col'
                    {...viewTransition}
                  >
                    <LandingPreviewTables autoOpenTableId={autoTableId} />
                  </motion.div>
                )}
                {activeView === 'files' && (
                  <motion.div
                    key='files'
                    className='flex h-full w-full flex-col'
                    {...viewTransition}
                  >
                    <LandingPreviewFiles />
                  </motion.div>
                )}
                {activeView === 'knowledge' && (
                  <motion.div
                    key='knowledge'
                    className='flex h-full w-full flex-col'
                    {...viewTransition}
                  >
                    <LandingPreviewKnowledge />
                  </motion.div>
                )}
                {activeView === 'logs' && (
                  <motion.div key='logs' className='flex h-full w-full flex-col' initial={false}>
                    <LandingPreviewLogs />
                  </motion.div>
                )}
                {activeView === 'scheduled-tasks' && (
                  <motion.div
                    key='scheduled-tasks'
                    className='flex h-full w-full flex-col'
                    {...viewTransition}
                  >
                    <LandingPreviewScheduledTasks />
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <div className='h-full w-full'>
                <LandingPreviewWorkflow workflow={activeWorkflow} />
              </div>
            )}
          </div>
          <motion.div
            className={isWorkflowView ? 'hidden lg:flex' : 'hidden'}
            variants={panelVariants}
          >
            <LandingPreviewPanel
              activeWorkflow={activeWorkflow}
              animationKey={animationKey}
              onHighlightBlock={handleHighlightBlock}
            />
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
