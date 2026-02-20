'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { LandingPreviewPanel } from '@/app/(home)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { LandingPreviewSidebar } from '@/app/(home)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
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
 * - A sidebar with two selectable workflows
 * - A ReactFlow canvas showing the active workflow's blocks and edges
 * - A panel with a functional copilot input (stores prompt + redirects to /signup)
 *
 * Everything except the workflow items and the copilot input is non-interactive.
 * On mount the sidebar slides from left and the panel from right. The canvas
 * background stays fully opaque; individual block nodes animate in with a
 * staggered fade. Edges draw left-to-right. Animations only fire on initial
 * load — workflow switches render instantly.
 */
export function LandingPreview() {
  const [activeWorkflowId, setActiveWorkflowId] = useState(PREVIEW_WORKFLOWS[0].id)
  const isInitialMount = useRef(true)

  useEffect(() => {
    isInitialMount.current = false
  }, [])

  const activeWorkflow =
    PREVIEW_WORKFLOWS.find((w) => w.id === activeWorkflowId) ?? PREVIEW_WORKFLOWS[0]

  return (
    <motion.div
      className='dark flex aspect-[1116/549] w-full overflow-hidden rounded bg-[#1b1b1b] antialiased'
      initial='hidden'
      animate='visible'
      variants={containerVariants}
    >
      <motion.div className='hidden lg:flex' variants={sidebarVariants}>
        <LandingPreviewSidebar
          workflows={PREVIEW_WORKFLOWS}
          activeWorkflowId={activeWorkflowId}
          onSelectWorkflow={setActiveWorkflowId}
        />
      </motion.div>
      <div className='relative flex-1 overflow-hidden'>
        <LandingPreviewWorkflow workflow={activeWorkflow} animate={isInitialMount.current} />
      </div>
      <motion.div className='hidden lg:flex' variants={panelVariants}>
        <LandingPreviewPanel />
      </motion.div>
    </motion.div>
  )
}
