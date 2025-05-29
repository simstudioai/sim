'use client'

import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/generic-workflow-preview'
import { Workflow } from '../types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TemplateWorkflowCard')

/**
 * TemplateWorkflowCardProps interface - defines the properties for the TemplateWorkflowCard component
 * @property {Workflow} workflow - The workflow data to display
 * @property {number} index - The index of the workflow in the list
 * @property {Function} onSelect - Optional callback function triggered when template is selected
 */
interface TemplateWorkflowCardProps {
  workflow: Workflow
  index: number
  onSelect?: (id: string) => void
}

/**
 * TemplateWorkflowCard component - Displays a template workflow in a card format
 * Navigates to template detail page on click instead of directly creating workflows
 * Shows either a workflow preview, thumbnail image, or fallback text
 */
export function TemplateWorkflowCard({ workflow, onSelect }: TemplateWorkflowCardProps) {
  const [isPreviewReady, setIsPreviewReady] = useState(!!workflow.workflowState)
  const router = useRouter()

  // When workflow state becomes available, update preview ready state
  useEffect(() => {
    if (workflow.workflowState && !isPreviewReady) {
      setIsPreviewReady(true)
    }
  }, [workflow.workflowState, isPreviewReady])

  /**
   * Handle template card click - navigate to template detail page
   */
  const handleClick = async () => {
    try {
      // Track view using the new organized endpoint
      await fetch(`/api/templates/${workflow.id}/view`, {
        method: 'POST',
      })

      // Use onSelect callback if provided, otherwise navigate to template detail page
      if (onSelect) {
        onSelect(workflow.id)
      } else {
        // Navigate to template detail page (fallback for external usage)
        router.push(`/w/templates/${workflow.id}`)
      }
    } catch (error) {
      logger.error('Failed to handle template click:', error)
      // Still trigger the selection/navigation even if tracking fails
      if (onSelect) {
        onSelect(workflow.id)
      } else {
        router.push(`/w/templates/${workflow.id}`)
      }
    }
  }

  return (
    <div
      className='block cursor-pointer'
      aria-label={`View ${workflow.name} template`}
      onClick={handleClick}
    >
      <Card className='flex h-full flex-col overflow-hidden transition-all hover:shadow-md hover:border-primary/20'>
        {/* Workflow preview/thumbnail area */}
        <div className='relative h-40 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900'>
          {isPreviewReady && workflow.workflowState ? (
            // Interactive Preview
            <div className='absolute inset-0 flex items-center justify-center'>
              <div className='h-full w-full scale-[0.9] transform-gpu'>
                <WorkflowPreview workflowState={workflow.workflowState} />
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
            </div>
          )}
        </div>
        <div className='flex flex-grow flex-col'>
          {/* Workflow title */}
          <CardHeader className='p-4 pb-2'>
            <h3 className='font-medium text-sm line-clamp-2'>{workflow.name}</h3>
          </CardHeader>
          {/* Workflow description */}
          <CardContent className='flex flex-grow flex-col p-4 pt-0 pb-2'>
            <p className='line-clamp-2 text-muted-foreground text-xs'>{workflow.description}</p>
          </CardContent>
          {/* Footer with author and stats */}
          <CardFooter className='mt-auto flex items-center justify-between p-4 pt-2'>
            <div className='text-muted-foreground text-xs'>by {workflow.author}</div>
            <div className='flex items-center'>
              <div className='flex items-center space-x-1'>
                <Eye className='h-3.5 w-3.5 text-muted-foreground' />
                <span className='font-medium text-muted-foreground text-xs'>{workflow.views}</span>
              </div>
            </div>
          </CardFooter>
        </div>
      </Card>
    </div>
  )
} 