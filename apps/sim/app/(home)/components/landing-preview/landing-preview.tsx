'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { LandingPreviewFiles } from '@/app/(home)/components/landing-preview/components/landing-preview-files/landing-preview-files'
import { LandingPreviewHome } from '@/app/(home)/components/landing-preview/components/landing-preview-home/landing-preview-home'
import { LandingPreviewKnowledge } from '@/app/(home)/components/landing-preview/components/landing-preview-knowledge/landing-preview-knowledge'
import { LandingPreviewLogs } from '@/app/(home)/components/landing-preview/components/landing-preview-logs/landing-preview-logs'
import { LandingPreviewPanel } from '@/app/(home)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { LandingPreviewScheduledTasks } from '@/app/(home)/components/landing-preview/components/landing-preview-scheduled-tasks/landing-preview-scheduled-tasks'
import type { SidebarView } from '@/app/(home)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewSidebar } from '@/app/(home)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewTables } from '@/app/(home)/components/landing-preview/components/landing-preview-tables/landing-preview-tables'
import { LandingPreviewWorkflow } from '@/app/(home)/components/landing-preview/components/landing-preview-workflow/landing-preview-workflow'
import {
  EASE_OUT,
  PREVIEW_WORKFLOWS,
} from '@/app/(home)/components/landing-preview/components/landing-preview-workflow/workflow-data'

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

/**
 * Interactive workspace preview for the hero section.
 *
 * Renders a lightweight replica of the Sim workspace with:
 * - A sidebar with selectable workflows and workspace nav items
 * - A ReactFlow canvas showing the active workflow's blocks and edges
 * - Static previews of Tables, Files, Knowledge Base, Logs, and Scheduled Tasks
 * - A panel with a functional copilot input (stores prompt + redirects to /signup)
 *
 * Only workflow items, the home button, workspace nav items, and the copilot input
 * are interactive. Animations only fire on initial load.
 */
export function LandingPreview() {
  const [activeView, setActiveView] = useState<SidebarView>('workflow')
  const [activeWorkflowId, setActiveWorkflowId] = useState(PREVIEW_WORKFLOWS[0].id)
  const isInitialMount = useRef(true)

  useEffect(() => {
    isInitialMount.current = false
  }, [])

  const handleSelectWorkflow = useCallback((id: string) => {
    setActiveWorkflowId(id)
    setActiveView('workflow')
  }, [])

  const handleSelectHome = useCallback(() => {
    setActiveView('home')
  }, [])

  const handleSelectNav = useCallback((id: SidebarView) => {
    setActiveView(id)
  }, [])

  const activeWorkflow =
    PREVIEW_WORKFLOWS.find((w) => w.id === activeWorkflowId) ?? PREVIEW_WORKFLOWS[0]

  const isWorkflowView = activeView === 'workflow'

  function renderContent() {
    switch (activeView) {
      case 'workflow':
        return <LandingPreviewWorkflow workflow={activeWorkflow} animate={isInitialMount.current} />
      case 'home':
        return <LandingPreviewHome />
      case 'tables':
        return <LandingPreviewTables />
      case 'files':
        return <LandingPreviewFiles />
      case 'knowledge':
        return <LandingPreviewKnowledge />
      case 'logs':
        return <LandingPreviewLogs />
      case 'scheduled-tasks':
        return <LandingPreviewScheduledTasks />
    }
  }

  return (
    <motion.div
      className='dark flex aspect-[1116/549] w-full overflow-hidden rounded bg-[var(--landing-bg-surface)] antialiased'
      initial='hidden'
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
        <div className='flex flex-1 overflow-hidden rounded-[8px] border border-[#2c2c2c] bg-[var(--landing-bg)]'>
          <div
            className={
              isWorkflowView
                ? 'relative min-w-0 flex-1 overflow-hidden'
                : 'relative flex min-w-0 flex-1 flex-col overflow-hidden'
            }
          >
            {renderContent()}
          </div>
          <motion.div
            className={isWorkflowView ? 'hidden lg:flex' : 'hidden'}
            variants={panelVariants}
          >
            <LandingPreviewPanel />
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
