'use client'

import { useEffect, useId, useState } from 'react'
import { Chip, cn } from '@sim/emcn'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { WorkflowPreviewCanvas } from '@/app/(landing)/workflows/components/workflow-builder-preview/components/workflow-preview-canvas'
import { PREVIEW_BLOCKS } from '@/app/(landing)/workflows/components/workflow-builder-preview/constants'

/** The production workflow cards, ports, selection toolbar, and run affordance in an open stage. */
export function WorkflowBuilderPreview() {
  const previewId = useId()
  const [selectedId, setSelectedId] = useState('draft')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [completedId, setCompletedId] = useState<string | null>(null)

  useEffect(() => {
    if (!runningId) return
    const timeout = window.setTimeout(() => {
      setCompletedId(runningId)
      setRunningId(null)
    }, 1200)
    return () => window.clearTimeout(timeout)
  }, [runningId])

  const handleRunToggle = (blockId: string) => {
    setSelectedId(blockId)
    setCompletedId(null)
    setRunningId((current) => (current === blockId ? null : blockId))
  }

  return (
    <div data-workflow-builder-preview className='absolute inset-0 overflow-clip bg-[var(--bg)]'>
      <div
        id={previewId}
        role='group'
        aria-label='Support request workflow: find knowledge, draft a reply, send it to Slack, and save a ticket'
        className={cn(
          '-translate-x-1/2 -translate-y-1/2 absolute top-[44%] left-1/2 h-[376px] w-[1210px] transition-transform duration-300 ease-out motion-reduce:transition-none',
          PREVIEW_BLOCKS.find((block) => block.id === selectedId)?.focusClassName
        )}
      >
        <div className='size-full @max-[1000px]:scale-[0.6] @max-[1280px]:scale-[0.78] @max-[760px]:scale-100'>
          <WorkflowPreviewCanvas
            selectedId={selectedId}
            runningId={runningId}
            completedId={completedId}
            onSelect={setSelectedId}
            onRunToggle={handleRunToggle}
          />
        </div>
      </div>
      <EdgeFade ground='canvas' edges={['left', 'right']} depth='preview' />
      <div className='absolute inset-x-5 bottom-8 z-10 flex flex-col items-center gap-3'>
        <div
          role='group'
          aria-label='Select a workflow block'
          className='flex flex-wrap justify-center gap-1.5'
        >
          {PREVIEW_BLOCKS.map((block) => (
            <Chip
              key={block.id}
              active={selectedId === block.id}
              aria-pressed={selectedId === block.id}
              aria-controls={previewId}
              onClick={() => setSelectedId(block.id)}
            >
              {block.selectorLabel}
            </Chip>
          ))}
        </div>
        <p role='status' aria-live='polite' className='text-[var(--text-secondary)] text-caption'>
          {runningId
            ? 'Running sample block…'
            : completedId
              ? 'Sample run complete'
              : 'Select a block to preview its controls'}
        </p>
      </div>
    </div>
  )
}
