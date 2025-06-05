'use client'

import { useEffect, useState } from 'react'
import { Download, Eye, Heart, Share2, Trash } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import {
  getCategoryColor,
  getCategoryIcon,
  getCategoryLabel,
} from '../../../../constants/categories'
import type { TemplateData } from '../../../../types'

const logger = createLogger('TemplateHero')

interface TemplateHeroProps {
  template: TemplateData
}

export function TemplateHero({ template }: TemplateHeroProps) {
  const router = useRouter()
  const { createWorkflow, workflows, updateWorkflow } = useWorkflowRegistry()
  const [isUsing, setIsUsing] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingSavedStatus, setIsLoadingSavedStatus] = useState(true)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const { addNotification } = useNotificationStore()

  const { data: session, isPending } = useSession()

  const isAuthor = !isPending && session?.user?.id === template.authorId

  useEffect(() => {
    const { notifications, removeNotification } = useNotificationStore.getState()

    notifications.forEach((notification) => {
      if (notification.type === 'info' && notification.workflowId === null) {
        removeNotification(notification.id)
      }
    })
  }, [])

  useEffect(() => {
    const checkSavedStatus = async () => {
      try {
        const response = await fetch(`/api/templates/${template.id}/saved-status`)
        if (response.ok) {
          const data = await response.json()
          setIsSaved(data.saved)
        }
      } catch (error) {
        logger.error('Error checking saved status:', error)
      } finally {
        setIsLoadingSavedStatus(false)
      }
    }

    checkSavedStatus()
  }, [template.id])

  const handleUseTemplate = async () => {
    try {
      setIsUsing(true)

      if (template.workflowState) {
        const newWorkflowId = createWorkflow({
          name: `${template.name} (Copy)`,
          description: template.shortDescription || '',
          templatesId: template.id,
          templatesState: template.workflowState,
        })

        router.push(`/w/${newWorkflowId}`)
      } else {
        logger.error('Cannot use template: workflow state is not available')
      }
    } catch (error) {
      logger.error('Failed to use template:', error)
    } finally {
      setIsUsing(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (isSaving) return

    setIsSaving(true)
    try {
      const method = isSaved ? 'DELETE' : 'POST'
      const response = await fetch(`/api/templates/${template.id}/save`, {
        method,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to ${isSaved ? 'unsave' : 'save'} template`)
      }

      const newSavedState = !isSaved
      setIsSaved(newSavedState)
    } catch (error: any) {
      logger.error('Error toggling save state:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Helper function to find and update workflows that reference this template
  const syncWorkflowRegistryState = () => {
    // Find all workflows that have this template as their templates data
    const workflowsToUpdate = Object.entries(workflows).filter(
      ([_, workflow]) => workflow.templatesData?.id === template.id
    )

    // Update each workflow to remove templates data
    workflowsToUpdate.forEach(([workflowId, _]) => {
      updateWorkflow(workflowId, {
        templatesData: null,
      })
    })

    if (workflowsToUpdate.length > 0) {
      // Trigger workflow sync to persist changes to database
      const workflowStore = useWorkflowStore.getState()
      if (workflowStore.sync) {
        workflowStore.sync.markDirty()
        workflowStore.sync.forceSync()
      }
    }
  }

  const handleUnpublishTemplate = async () => {
    if (!isAuthor) {
      addNotification('error', 'You are not authorized to unpublish this template', null)
      return
    }

    try {
      setIsUnpublishing(true)

      const response = await fetch(`/api/templates/${template.id}/unpublish`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Error response from unpublish endpoint', {
          status: response.status,
          data: errorData,
        })
        throw new Error(errorData.error || 'Failed to unpublish template')
      }

      // Sync workflow registry state to remove templates data from workflows
      syncWorkflowRegistryState()

      addNotification('info', `Template "${template.name}" has been unpublished`, null)

      router.push('/w/templates')
    } catch (error: any) {
      logger.error('Error unpublishing template:', error)
      addNotification('error', `Failed to unpublish template: ${error.message}`, null)
    } finally {
      setIsUnpublishing(false)
    }
  }

  const handleShareTemplate = async () => {
    try {
      const templateUrl = `https://simstudio.ai/w/templates/${template.id}`
      const shareText = `Check this template out on Sim Studio! ${templateUrl}`

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareText)
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement('textarea')
        textArea.value = shareText
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        textArea.style.pointerEvents = 'none'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }

      addNotification('info', 'Template link copied!', null, {
        isPersistent: false,
      })
    } catch (error) {
      logger.error('Failed to copy template share text:', error)

      addNotification('error', 'Failed to copy link', null, {
        isPersistent: false,
      })
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const getAuthorInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const categoryColor = getCategoryColor(template.category || '')
  const categoryIcon = getCategoryIcon(template.category || '')

  return (
    <div className='space-y-6'>
      {/* Category Badge */}
      <div>
        <Badge
          variant='outline'
          className='flex w-fit items-center'
          style={{
            borderColor: categoryColor,
            color: categoryColor,
          }}
        >
          {categoryIcon}
          {getCategoryLabel(template.category || '')}
        </Badge>
      </div>

      {/* Title */}
      <div>
        <h1 className='mb-2 font-bold text-3xl text-foreground'>{template.name} Template</h1>
      </div>

      {/* Author and Stats */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-muted'>
            <span className='font-medium text-muted-foreground text-xs'>
              {getAuthorInitials(template.authorName)}
            </span>
          </div>
          <div>
            <p className='font-medium text-foreground text-sm'>{template.authorName}</p>
            <p className='text-muted-foreground text-xs'>
              Created {formatDate(template.createdAt)}
            </p>
          </div>
        </div>

        <div className='flex items-center space-x-1 text-muted-foreground'>
          <Eye className='h-4 w-4' />
          <span className='text-sm'>{template.views.toLocaleString()}</span>
        </div>
      </div>

      {/* Long Description */}
      <div className='prose prose-sm max-w-none'>
        <p className='text-muted-foreground'>{template.longDescription}</p>
      </div>

      {/* Action Buttons */}
      <div className='flex flex-wrap gap-3'>
        <Button
          onClick={handleUseTemplate}
          disabled={isUsing || !template.workflowState}
          className='flex-1 sm:flex-none'
        >
          {isUsing ? (
            <>
              <Download className='mr-2 h-4 w-4 animate-pulse' />
              Creating...
            </>
          ) : (
            <>
              <Download className='mr-2 h-4 w-4' />
              Use This Template
            </>
          )}
        </Button>

        <Button
          variant='outline'
          size='default'
          onClick={handleSaveTemplate}
          disabled={isSaving || isLoadingSavedStatus}
          className={isSaved ? 'bg-accent' : ''}
        >
          <Heart className={`mr-2 h-4 w-4 ${isSaved ? 'fill-current' : ''}`} />
          {isLoadingSavedStatus
            ? 'Loading...'
            : isSaving
              ? 'Saving...'
              : isSaved
                ? 'Saved'
                : 'Save'}
        </Button>

        <Button variant='outline' size='default' onClick={handleShareTemplate}>
          <Share2 className='mr-2 h-4 w-4' />
          Share
        </Button>

        {/* Unpublish Button - Only show if user is the author */}
        {!isPending && isAuthor && (
          <Button
            variant='destructive'
            size='default'
            onClick={handleUnpublishTemplate}
            disabled={isUnpublishing}
          >
            {isUnpublishing ? (
              <>
                <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                Unpublishing...
              </>
            ) : (
              <>
                <Trash className='mr-2 h-4 w-4' />
                Unpublish
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
