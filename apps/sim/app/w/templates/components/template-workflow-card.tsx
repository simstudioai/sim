'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'
import type { Workflow } from '../types'
import { TemplateBadges } from './template-badges'

const logger = createLogger('TemplateWorkflowCard')

/**
 * TemplateWorkflowCardProps interface - defines the properties for the TemplateWorkflowCard component
 * @property {Workflow} workflow - The workflow data to display
 * @property {number} index - The index of the workflow in the list
 * @property {Function} onHover - Optional callback function triggered when card is hovered to load workflow state
 * @property {Function} onMount - Optional callback function triggered when card mounts for intersection observer registration
 */
interface TemplateWorkflowCardProps {
  workflow: Workflow
  index: number
  onHover?: (id: string) => void
  onMount?: (element: HTMLElement, templateId: string) => void
}

/**
 * TemplateWorkflowCard component - Unified workflow card for template browsing
 * Navigates to template detail page on click and loads workflow state on hover for better UX
 * Shows either a workflow preview, thumbnail image, or fallback text
 */
export function TemplateWorkflowCard({ workflow, onHover, onMount }: TemplateWorkflowCardProps) {
  const [isPreviewReady, setIsPreviewReady] = useState(!!workflow.workflowState)
  const router = useRouter()
  const cardRef = useRef<HTMLDivElement>(null)

  // When workflow state becomes available, update preview ready state
  useEffect(() => {
    if (workflow.workflowState && !isPreviewReady) {
      setIsPreviewReady(true)
    }
  }, [workflow.workflowState, isPreviewReady])

  // Register with intersection observer when component mounts
  useEffect(() => {
    if (cardRef.current && onMount) {
      onMount(cardRef.current, workflow.id)
    }
  }, [onMount, workflow.id])

  /**
   * Handle mouse enter event
   * Triggers onHover callback to load workflow state if needed for preview
   */
  const handleMouseEnter = () => {
    if (onHover && !workflow.workflowState) {
      onHover(workflow.id)
    }
  }

  /**
   * Handle template card click - navigate to template detail page
   */
  const handleClick = async () => {
    try {
      router.push(`/w/templates/${workflow.id}`)
    } catch (error) {
      logger.error('Failed to handle template click:', error)
      router.push(`/w/templates/${workflow.id}`)
    }
  }

  return (
    <div
      ref={cardRef}
      className='block cursor-pointer'
      aria-label={`View ${workflow.name} template`}
      onClick={handleClick}
      data-template-id={workflow.id}
      data-has-state={!!workflow.workflowState}
      data-is-loading={workflow.isStateLoading}
    >
      <div className='space-y-3'>
        <Card
          className='flex h-80 flex-col overflow-hidden transition-all hover:border-primary/20 hover:shadow-md'
          onMouseEnter={handleMouseEnter}
        >
          {/* Workflow preview/thumbnail area */}
          <div className='relative h-52 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900'>
            {isPreviewReady && workflow.workflowState ? (
              // Interactive Preview
              <div className='absolute inset-0 flex items-center justify-center overflow-hidden'>
                <div className='h-full w-full scale-[0.9] transform-gpu overflow-hidden'>
                  <WorkflowPreview
                    workflowState={workflow.workflowState}
                    height='100%'
                    width='100%'
                    isPannable={false}
                    showSubBlocks={false}
                    zoomable={false}
                  />
                </div>
              </div>
            ) : workflow.thumbnail ? (
              // Show static thumbnail image if available
              <div
                className='h-full w-full bg-center bg-cover'
                style={{
                  backgroundImage: `url(${workflow.thumbnail})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center top',
                }}
              />
            ) : (
              // Fallback to text if no preview or thumbnail is available
              <div className='flex h-full w-full items-center justify-center'>
                <span className='font-medium text-lg text-muted-foreground'>{workflow.name}</span>
                {/* Show loading indicator when state is being loaded */}
                {workflow.isStateLoading && (
                  <div className='absolute inset-0 flex items-center justify-center bg-background/80'>
                    <div className='h-8 w-8 animate-spin rounded-full border-primary border-b-2' />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className='flex h-28 flex-grow flex-col'>
            {/* Workflow title */}
            <CardHeader className='p-4 pb-2'>
              <h3 className='line-clamp-2 font-medium text-sm'>{workflow.name}</h3>
            </CardHeader>
            {/* Workflow description */}
            <CardContent className='flex flex-grow flex-col p-4 pt-0 pb-4'>
              <p className='line-clamp-2 text-muted-foreground text-xs'>{workflow.description}</p>
            </CardContent>
          </div>
        </Card>

        {/* Template badges below the card */}
        <TemplateBadges
          authorName={workflow.author}
          views={workflow.views}
          price={workflow.price}
          className='px-1'
        />
      </div>
    </div>
  )
}
