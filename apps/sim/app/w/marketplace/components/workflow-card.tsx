'use client'

import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/generic-workflow-preview'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { Workflow } from '../marketplace'

/**
 * WorkflowCardProps interface - defines the properties for the WorkflowCard component
 * @property {Workflow} workflow - The workflow data to display
 * @property {number} index - The index of the workflow in the list
 * @property {Function} onHover - Optional callback function triggered when card is hovered
 */
interface WorkflowCardProps {
  workflow: Workflow
  index: number
  onHover?: (id: string) => void
}

/**
 * WorkflowCard component - Displays a workflow in a card format
 * Shows either a workflow preview, thumbnail image, or fallback text
 * State is now pre-loaded in most cases, fallback to load on hover if needed
 */
export function WorkflowCard({ workflow, onHover }: WorkflowCardProps) {
  const [isPreviewReady, setIsPreviewReady] = useState(!!workflow.workflowState)
  const router = useRouter()
  const { createWorkflow } = useWorkflowRegistry()

  // When workflow state becomes available, update preview ready state
  useEffect(() => {
    if (workflow.workflowState && !isPreviewReady) {
      setIsPreviewReady(true)
    }
  }, [workflow.workflowState, isPreviewReady])

  /**
   * Handle mouse enter event
   * Sets hover state and triggers onHover callback to load workflow state if needed
   */
  const handleMouseEnter = () => {
    if (onHover && !workflow.workflowState) {
      onHover(workflow.id)
    }
  }

  /**
   * Handle workflow card click - track views and import workflow
   */
  const handleClick = async () => {
    try {
      // Track view
      await fetch('/api/marketplace/workflows', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: workflow.id }),
      })

      // Create a local copy of the marketplace workflow
      if (workflow.workflowState) {
        const newWorkflowId = createWorkflow({
          name: `${workflow.name} (Copy)`,
          description: workflow.description,
          marketplaceId: workflow.id,
          marketplaceState: workflow.workflowState,
        })

        // Navigate to the new workflow
        router.push(`/w/${newWorkflowId}`)
      } else {
        console.error('Cannot import workflow: state is not available')
      }
    } catch (error) {
      console.error('Failed to handle workflow click:', error)
    }
  }

  return (
    <div
      className='block cursor-pointer'
      aria-label={`View ${workflow.name} workflow`}
      onClick={handleClick}
    >
      <Card
        className='flex h-full flex-col overflow-hidden transition-all hover:shadow-md'
        onMouseEnter={handleMouseEnter}
      >
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
            <h3 className='font-medium text-sm'>{workflow.name}</h3>
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
