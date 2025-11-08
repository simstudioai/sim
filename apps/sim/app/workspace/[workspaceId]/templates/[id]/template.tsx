'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  Cloud,
  Code,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Edit,
  Eye,
  FileText,
  Folder,
  Globe,
  HeadphonesIcon,
  Layers,
  Lightbulb,
  LineChart,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Phone,
  Play,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  User,
  Users,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { Template } from '@/app/workspace/[workspaceId]/templates/templates'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateDetails')

interface TemplateDetailsProps {
  template: Template
  workspaceId: string
  currentUserId: string | null
}

// Icon mapping - reuse from template-card
const iconMap = {
  FileText,
  NotebookPen,
  BookOpen,
  Edit,
  BarChart3,
  LineChart,
  TrendingUp,
  Target,
  Database,
  Server,
  Cloud,
  Folder,
  Megaphone,
  Mail,
  MessageSquare,
  Phone,
  Bell,
  DollarSign,
  CreditCard,
  Calculator,
  ShoppingCart,
  Briefcase,
  HeadphonesIcon,
  Users,
  Settings,
  Wrench,
  Bot,
  Brain,
  Cpu,
  Code,
  Zap,
  Workflow,
  Search,
  Play,
  Layers,
  Lightbulb,
  Globe,
  Award,
}

// Get icon component from template-card logic
const getIconComponent = (icon: string): React.ReactNode => {
  const IconComponent = iconMap[icon as keyof typeof iconMap]
  return IconComponent ? <IconComponent className='h-6 w-6' /> : <FileText className='h-6 w-6' />
}

export default function TemplateDetails({
  template,
  workspaceId,
  currentUserId,
}: TemplateDetailsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Defensive check for template BEFORE initializing state hooks
  if (!template) {
    logger.error('Template prop is undefined or null in TemplateDetails component', {
      template,
      workspaceId,
      currentUserId,
    })
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>Template Not Found</h1>
          <p className='text-muted-foreground'>The template you're looking for doesn't exist.</p>
          <p className='mt-2 text-muted-foreground text-xs'>Template data failed to load</p>
        </div>
      </div>
    )
  }

  logger.info('Template loaded in TemplateDetails', {
    id: template.id,
    name: template.name,
    hasState: !!template.state,
  })

  const [isStarred, setIsStarred] = useState(template.isStarred || false)
  const [starCount, setStarCount] = useState(template.stars || 0)
  const [isStarring, setIsStarring] = useState(false)
  const [isUsing, setIsUsing] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const isOwner = currentUserId && template.userId === currentUserId

  // Auto-use template after login if use=true query param is present
  useEffect(() => {
    const shouldAutoUse = searchParams?.get('use') === 'true'
    if (shouldAutoUse && currentUserId && !isUsing) {
      handleUseTemplate()
      // Clean up URL
      router.replace(`/workspace/${workspaceId}/templates/${template.id}`)
    }
  }, [searchParams, currentUserId])

  // Render workflow preview exactly like deploy-modal.tsx
  const renderWorkflowPreview = () => {
    // Follow the same pattern as deployed-workflow-card.tsx
    if (!template?.state) {
      logger.info('Template has no state:', template)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium text-lg'>⚠️ No Workflow Data</div>
            <div className='text-sm'>This template doesn't contain workflow state data.</div>
          </div>
        </div>
      )
    }

    logger.info('Template state:', template.state)
    logger.info('Template state type:', typeof template.state)
    logger.info('Template state blocks:', template.state.blocks)
    logger.info('Template state edges:', template.state.edges)

    try {
      return (
        <WorkflowPreview
          workflowState={template.state as WorkflowState}
          showSubBlocks={true}
          height='100%'
          width='100%'
          isPannable={true}
          defaultPosition={{ x: 0, y: 0 }}
          defaultZoom={1}
        />
      )
    } catch (error) {
      console.error('Error rendering workflow preview:', error)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium text-lg'>⚠️ Preview Error</div>
            <div className='text-sm'>Unable to render workflow preview</div>
          </div>
        </div>
      )
    }
  }

  const handleBack = () => {
    router.back()
  }

  const handleStarToggle = async () => {
    if (isStarring || !currentUserId) return

    setIsStarring(true)
    try {
      const method = isStarred ? 'DELETE' : 'POST'
      const response = await fetch(`/api/templates/${template.id}/star`, { method })

      if (response.ok) {
        setIsStarred(!isStarred)
        setStarCount((prev) => (isStarred ? prev - 1 : prev + 1))
      }
    } catch (error) {
      logger.error('Error toggling star:', error)
    } finally {
      setIsStarring(false)
    }
  }

  const handleUseTemplate = async () => {
    if (isUsing) return

    // Check if user is logged in
    if (!currentUserId) {
      // Redirect to login with callback URL to use template after login
      const callbackUrl = encodeURIComponent(
        `/workspace/${workspaceId}/templates/${template.id}?use=true`
      )
      router.push(`/login?callbackUrl=${callbackUrl}`)
      return
    }

    setIsUsing(true)
    try {
      const response = await fetch(`/api/templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        throw new Error('Failed to use template')
      }

      const { workflowId } = await response.json()

      // Navigate to the new workflow
      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
    } catch (error) {
      logger.error('Error using template:', error)
    } finally {
      setIsUsing(false)
    }
  }

  const handleEditTemplate = async () => {
    if (isEditing || !currentUserId) return

    setIsEditing(true)
    try {
      // If template already has a connected workflowId, check if it exists in user's workspace
      if (template.workflowId) {
        // Try to fetch the workflow to see if it still exists
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)

        if (checkResponse.ok) {
          // Workflow exists, redirect to it
          router.push(`/workspace/${workspaceId}/w/${template.workflowId}`)
          return
        }
      }

      // No connected workflow or it was deleted - create a new one
      const response = await fetch(`/api/templates/${template.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        throw new Error('Failed to edit template')
      }

      const { workflowId } = await response.json()

      // Navigate to the workflow
      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
    } catch (error) {
      logger.error('Error editing template:', error)
    } finally {
      setIsEditing(false)
    }
  }

  return (
    <div className='flex min-h-screen flex-col'>
      {/* Header */}
      <div className='border-b bg-background p-6'>
        <div className='mx-auto max-w-7xl'>
          {/* Back button */}
          <button
            onClick={handleBack}
            className='mb-6 flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
          >
            <ArrowLeft className='h-4 w-4' />
            <span className='text-sm'>Go back</span>
          </button>

          {/* Template header */}
          <div className='flex items-start justify-between'>
            <div className='flex items-start gap-4'>
              {/* Icon */}
              <div
                className='flex h-12 w-12 items-center justify-center rounded-lg'
                style={{ backgroundColor: template.color }}
              >
                {getIconComponent(template.icon)}
              </div>

              {/* Title and description */}
              <div>
                <h1 className='font-bold text-3xl text-foreground'>{template.name}</h1>
                <p className='mt-2 max-w-3xl text-lg text-muted-foreground'>
                  {template.description}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className='flex items-center gap-3'>
              {/* Star button - only for logged-in users */}
              {currentUserId && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={handleStarToggle}
                  disabled={isStarring}
                  className={cn(
                    'transition-colors',
                    isStarred &&
                      'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  )}
                >
                  <Star className={cn('mr-2 h-4 w-4', isStarred && 'fill-current')} />
                  {starCount}
                </Button>
              )}

              {/* Edit button - only for template owner when logged in */}
              {isOwner && currentUserId && (
                <Button
                  variant='outline'
                  onClick={handleEditTemplate}
                  disabled={isEditing}
                  className='border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                >
                  <Edit className='mr-2 h-4 w-4' />
                  {isEditing ? 'Opening...' : 'Edit'}
                </Button>
              )}

              {/* Use template button */}
              <Button
                onClick={handleUseTemplate}
                disabled={isUsing}
                className='bg-purple-600 text-white hover:bg-purple-700'
              >
                {isUsing ? 'Creating...' : currentUserId ? 'Use this template' : 'Sign in to use'}
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className='mt-6 flex items-center gap-3 text-muted-foreground text-sm'>
            {/* Views */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <Eye className='h-3 w-3' />
              <span>{template.views} views</span>
            </div>

            {/* Stars */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <Star className='h-3 w-3' />
              <span>{starCount} stars</span>
            </div>

            {/* Author */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <User className='h-3 w-3' />
              <span>by {template.author}</span>
            </div>

            {/* Author Type - show if organization */}
            {template.authorType === 'organization' && (
              <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
                <Users className='h-3 w-3' />
                <span>Organization</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workflow preview */}
      <div className='flex-1 p-6'>
        <div className='mx-auto max-w-7xl'>
          <h2 className='mb-4 font-semibold text-xl'>Workflow Preview</h2>
          <div className='h-[600px] w-full'>{renderWorkflowPreview()}</div>
        </div>
      </div>
    </div>
  )
}
