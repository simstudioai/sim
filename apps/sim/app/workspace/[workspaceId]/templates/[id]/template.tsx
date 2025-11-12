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
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { Template } from '@/app/workspace/[workspaceId]/templates/templates'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateDetails')

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

/**
 * Get icon component from template icon name
 */
const getIconComponent = (icon: string): React.ReactNode => {
  const IconComponent = iconMap[icon as keyof typeof iconMap]
  return IconComponent ? (
    <IconComponent className='h-[14px] w-[14px]' />
  ) : (
    <FileText className='h-[14px] w-[14px]' />
  )
}

/**
 * Template detail page component
 * Fetches and displays detailed information about a specific template
 */
export default function TemplateDetails() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()

  const workspaceId = params?.workspaceId as string
  const templateId = params?.id as string

  // State for template data
  const [template, setTemplate] = useState<Template | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isStarred, setIsStarred] = useState(false)
  const [starCount, setStarCount] = useState(0)
  const [isStarring, setIsStarring] = useState(false)
  const [isUsing, setIsUsing] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Fetch template data on client side
  useEffect(() => {
    if (!templateId || !workspaceId) {
      setLoading(false)
      return
    }

    const fetchTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${templateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data.data)
          setIsStarred(data.data.isStarred || false)
          setStarCount(data.data.stars || 0)
        }
      } catch (error) {
        logger.error('Error fetching template:', error)
      } finally {
        setLoading(false)
      }
    }

    const fetchCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/get-session')
        if (response.ok) {
          const data = await response.json()
          setCurrentUserId(data?.user?.id || null)
        } else {
          setCurrentUserId(null)
        }
      } catch (error) {
        logger.error('Error fetching session:', error)
        setCurrentUserId(null)
      }
    }

    fetchTemplate()
    fetchCurrentUser()
  }, [templateId, workspaceId])

  // Auto-use template after login if use=true query param is present
  useEffect(() => {
    if (!template?.id) return
    const shouldAutoUse = searchParams?.get('use') === 'true'
    if (shouldAutoUse && currentUserId && !isUsing) {
      handleUseTemplate()
      router.replace(`/workspace/${workspaceId}/templates/${template.id}`)
    }
  }, [searchParams, currentUserId, template?.id])

  if (loading) {
    return (
      <div className='flex h-[100vh] items-center justify-center pl-64'>
        <div className='text-center'>
          <div className='mb-[14px] font-medium text-[18px]'>Loading...</div>
          <p className='text-[var(--text-tertiary)] text-[14px]'>Fetching template details</p>
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className='flex h-[100vh] items-center justify-center pl-64'>
        <div className='text-center'>
          <h1 className='mb-[14px] font-medium text-[18px]'>Template Not Found</h1>
          <p className='text-[var(--text-tertiary)] text-[14px]'>
            The template you're looking for doesn't exist.
          </p>
        </div>
      </div>
    )
  }

  const templateAuthor = template.author || template.creator?.name || 'Unknown'
  const templateAuthorType = template.authorType || template.creator?.referenceType || 'user'
  const templateDescription = template.description || template.details?.tagline || null
  const templateColor = template.color || 'var(--brand-primary)'
  const templateIcon = template.icon || 'Workflow'

  const templateOwnerId =
    template.userId ||
    (template.creator?.referenceType === 'user' ? template.creator.referenceId : null)
  const isOwner = currentUserId && templateOwnerId === currentUserId

  const renderWorkflowPreview = () => {
    if (!template?.state) {
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-[var(--text-tertiary)]'>
            <div className='mb-[10px] font-medium text-[14px]'>⚠️ No Workflow Data</div>
            <div className='text-[12px]'>This template doesn't contain workflow state data.</div>
          </div>
        </div>
      )
    }

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
      logger.error('Error rendering workflow preview:', error)
      return (
        <div className='flex h-full items-center justify-center text-center'>
          <div className='text-[var(--text-tertiary)]'>
            <div className='mb-[10px] font-medium text-[14px]'>⚠️ Preview Error</div>
            <div className='text-[12px]'>Unable to render workflow preview</div>
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

    if (!currentUserId) {
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
      if (template.workflowId) {
        const checkResponse = await fetch(`/api/workflows/${template.workflowId}`)

        if (checkResponse.ok) {
          router.push(`/workspace/${workspaceId}/w/${template.workflowId}`)
          return
        }
      }

      const response = await fetch(`/api/templates/${template.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        throw new Error('Failed to edit template')
      }

      const { workflowId } = await response.json()
      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
    } catch (error) {
      logger.error('Error editing template:', error)
    } finally {
      setIsEditing(false)
    }
  }

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
        <button
          onClick={handleBack}
          className='mb-[14px] flex items-center gap-[8px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
        >
          <ArrowLeft className='h-[14px] w-[14px]' />
          <span className='font-medium text-[12px]'>Go back</span>
        </button>

        <div>
          <div className='flex items-start gap-[12px]'>
            <div
              className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px]'
              style={{ backgroundColor: templateColor }}
            >
              {getIconComponent(templateIcon)}
            </div>
            <h1 className='font-medium text-[18px]'>{template.name}</h1>
          </div>
          <p className='mt-[10px] font-base text-[var(--text-tertiary)] text-[14px]'>
            {templateDescription}
          </p>
        </div>

        <div className='mt-[14px] flex items-center justify-between'>
          <div className='flex items-center gap-[12px] font-medium text-[var(--text-tertiary)] text-[12px]'>
            <div className='flex items-center gap-[6px]'>
              <Eye className='h-[12px] w-[12px]' />
              <span>{template.views} views</span>
            </div>
            <div className='flex items-center gap-[6px]'>
              <Star className='h-[12px] w-[12px]' />
              <span>{starCount} stars</span>
            </div>
            <div className='flex items-center gap-[6px]'>
              <User className='h-[12px] w-[12px]' />
              <span>by {templateAuthor}</span>
            </div>
            {templateAuthorType === 'organization' && (
              <div className='flex items-center gap-[6px]'>
                <Users className='h-[12px] w-[12px]' />
                <span>Organization</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className='flex items-center gap-[8px]'>
            {/* Star button - only for logged-in users */}
            {currentUserId && (
              <Button
                variant={isStarred ? 'active' : 'default'}
                className='h-[32px] rounded-[6px]'
                onClick={handleStarToggle}
                disabled={isStarring}
              >
                <Star className={cn('mr-[6px] h-[14px] w-[14px]', isStarred && 'fill-current')} />
                <span className='font-medium text-[12px]'>{starCount}</span>
              </Button>
            )}

            {/* Edit button - only for template owner when logged in */}
            {isOwner && currentUserId && (
              <Button
                variant='default'
                className='h-[32px] rounded-[6px]'
                onClick={handleEditTemplate}
                disabled={isEditing}
              >
                <Edit className='mr-[6px] h-[14px] w-[14px]' />
                <span className='font-medium text-[12px]'>{isEditing ? 'Opening...' : 'Edit'}</span>
              </Button>
            )}

            {/* Use template button */}
            <Button
              variant='active'
              className='h-[32px] rounded-[6px]'
              onClick={handleUseTemplate}
              disabled={isUsing}
            >
              <span className='font-medium text-[12px]'>
                {isUsing ? 'Creating...' : currentUserId ? 'Use this template' : 'Sign in to use'}
              </span>
            </Button>
          </div>
        </div>

        <div className='mt-[24px] h-[1px] w-full border-[var(--border)] border-t' />

        <div className='mt-[24px] flex-1'>
          <h2 className='mb-[14px] font-medium text-[14px]'>Workflow Preview</h2>
          <div className='h-[calc(100vh-280px)] w-full overflow-hidden rounded-[8px] bg-[var(--surface-3)]'>
            {renderWorkflowPreview()}
          </div>
        </div>
      </div>
    </div>
  )
}
