'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, Star } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Workflow } from '../marketplace'
import { WorkflowPreview } from './workflow-preview'

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
   * Handle workflow card click - track views
   */
  const handleClick = async () => {
    try {
      await fetch(`/api/marketplace/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: workflow.id }),
      })
    } catch (error) {
      console.error('Failed to track workflow view:', error)
    }
  }

  // Extract the actual workflow ID from workflow
  const workflowUrl = workflow.workflowUrl || `/w/${workflow.id}`

  return (
    <Link
      href={workflowUrl}
      className="block"
      aria-label={`View ${workflow.name} workflow`}
      onClick={handleClick}
    >
      <Card
        className="overflow-hidden transition-all hover:shadow-md flex flex-col h-full"
        onMouseEnter={handleMouseEnter}
      >
        {/* Workflow preview/thumbnail area */}
        <div className="h-40 relative overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
          {isPreviewReady && workflow.workflowState ? (
            // Show interactive workflow preview if state is available
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-full h-full transform-gpu scale-[0.8]">
                <WorkflowPreview workflowState={workflow.workflowState} />
              </div>
            </div>
          ) : workflow.thumbnail ? (
            // Show static thumbnail image if available
            <div
              className="h-full w-full bg-cover bg-center"
              style={{
                backgroundImage: `url(${workflow.thumbnail})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center top',
              }}
            />
          ) : (
            // Fallback to text if no preview or thumbnail is available
            <div className="h-full w-full flex items-center justify-center">
              <span className="text-muted-foreground font-medium text-lg">{workflow.name}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col flex-grow">
          {/* Workflow title */}
          <CardHeader className="p-4 pb-2">
            <h3 className="font-medium text-sm">{workflow.name}</h3>
          </CardHeader>
          {/* Workflow description */}
          <CardContent className="p-4 pt-0 pb-2 flex-grow flex flex-col">
            <p className="text-xs text-muted-foreground line-clamp-2">{workflow.description}</p>
          </CardContent>
          {/* Footer with author and stats */}
          <CardFooter className="p-4 pt-2 mt-auto flex justify-between items-center">
            <div className="text-xs text-muted-foreground">by {workflow.author}</div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1">
                <Star className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">{workflow.stars}</span>
              </div>
              <div className="flex items-center space-x-1">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">{workflow.views}</span>
              </div>
            </div>
          </CardFooter>
        </div>
      </Card>
    </Link>
  )
}
