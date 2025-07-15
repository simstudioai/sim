'use client'

import { useState } from 'react'
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
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { Template } from '../templates'
import { categories } from '../templates'

const logger = createLogger('TemplateDetails')

interface TemplateDetailsProps {
  template: Template
  workspaceId: string
  currentUserId: string
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

// Get category display name
const getCategoryDisplayName = (categoryValue: string): string => {
  const category = categories.find((c) => c.value === categoryValue)
  return category?.label || categoryValue
}

export default function TemplateDetails({
  template,
  workspaceId,
  currentUserId,
}: TemplateDetailsProps) {
  const router = useRouter()
  const [isStarred, setIsStarred] = useState(template?.isStarred || false)
  const [starCount, setStarCount] = useState(template?.stars || 0)
  const [isStarring, setIsStarring] = useState(false)
  const [isUsing, setIsUsing] = useState(false)

  // Defensive check for template after hooks are initialized
  if (!template) {
    return (
      <div className='flex h-screen items-center justify-center'>
        <div className='text-center'>
          <h1 className='mb-4 font-bold text-2xl'>Template Not Found</h1>
          <p className='text-muted-foreground'>The template you're looking for doesn't exist.</p>
        </div>
      </div>
    )
  }

  // Render workflow preview exactly like deploy-modal.tsx
  const renderWorkflowPreview = () => {
    // Follow the same pattern as deployed-workflow-card.tsx
    if (!template?.state) {
      console.log('Template has no state:', template)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-muted-foreground'>
            <div className='mb-2 font-medium text-lg'>⚠️ No Workflow Data</div>
            <div className='text-sm'>This template doesn't contain workflow state data.</div>
          </div>
        </div>
      )
    }

    console.log('Template state:', template.state)
    console.log('Template state type:', typeof template.state)
    console.log('Template state blocks:', template.state.blocks)
    console.log('Template state edges:', template.state.edges)

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
    if (isStarring) return

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

    setIsUsing(true)
    try {
      // TODO: Implement proper template usage logic
      // This should create a new workflow from the template state
      // For now, we'll create a basic workflow and navigate to it
      logger.info('Using template:', template.id)

      // Create a new workflow
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${template.name} (Copy)`,
          description: `Created from template: ${template.name}`,
          color: template.color,
          workspaceId,
          folderId: null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create workflow from template')
      }

      const newWorkflow = await response.json()

      // Navigate to the new workflow
      router.push(`/workspace/${workspaceId}/w/${newWorkflow.id}`)
    } catch (error) {
      logger.error('Error using template:', error)
      // Show error to user (could implement toast notification)
    } finally {
      setIsUsing(false)
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
              {/* Star button */}
              <Button
                variant='outline'
                size='sm'
                onClick={handleStarToggle}
                disabled={isStarring}
                className={cn(
                  'transition-colors',
                  isStarred && 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                )}
              >
                <Star className={cn('mr-2 h-4 w-4', isStarred && 'fill-current')} />
                {starCount}
              </Button>

              {/* Use template button */}
              <Button
                onClick={handleUseTemplate}
                disabled={isUsing}
                className='bg-purple-600 text-white hover:bg-purple-700'
              >
                Use this template
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className='mt-6 flex items-center gap-3 text-muted-foreground text-sm'>
            {/* Category */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <span>{getCategoryDisplayName(template.category)}</span>
            </div>

            {/* Views */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <Eye className='h-3 w-3' />
              <span>{template.views}</span>
            </div>

            {/* Stars */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <Star className='h-3 w-3' />
              <span>{starCount}</span>
            </div>

            {/* Author */}
            <div className='flex items-center gap-1 rounded-full bg-secondary px-3 py-1'>
              <User className='h-3 w-3' />
              <span>by {template.author}</span>
            </div>
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
