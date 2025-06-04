'use client'

import { useEffect, useState } from 'react'
import { Download, Eye, Heart, Share2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
  const { createWorkflow } = useWorkflowRegistry()
  const [isUsing, setIsUsing] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingSavedStatus, setIsLoadingSavedStatus] = useState(true)
  const { addNotification } = useNotificationStore()

  // Clear any existing share notifications when component mounts
  useEffect(() => {
    const { notifications, removeNotification } = useNotificationStore.getState()

    // Remove any existing global info notifications to prevent stale notifications
    notifications.forEach((notification) => {
      if (notification.type === 'info' && notification.workflowId === null) {
        removeNotification(notification.id)
      }
    })
  }, [])

  // Check initial saved status when component mounts
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

  // Handle using the template
  const handleUseTemplate = async () => {
    try {
      setIsUsing(true)

      // Create a local copy of the template workflow
      if (template.workflowState) {
        const newWorkflowId = createWorkflow({
          name: `${template.name} (Copy)`,
          description: template.short_description || '',
          marketplaceId: template.id,
          marketplaceState: template.workflowState,
        })

        // Navigate to the new workflow
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

  // Handle saving/unsaving template
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

      logger.info(`Template ${template.id} ${newSavedState ? 'saved' : 'unsaved'} successfully`)
    } catch (error: any) {
      logger.error('Error toggling save state:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Handle sharing template
  const handleShareTemplate = async () => {
    try {
      // Create the share message with URL
      const templateUrl = `https://simstudio.ai/w/templates/${template.id}`
      const shareText = `Check this template out on Sim Studio! ${templateUrl}`

      // Copy both message and URL to clipboard
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

      // Show success notification (use null for workflowId since template pages don't have one)
      addNotification('info', 'Template link copied!', null, {
        isPersistent: false,
      })

      logger.info('Template share text copied to clipboard:', shareText)
    } catch (error) {
      logger.error('Failed to copy template share text:', error)

      // Show error notification
      addNotification('error', 'Failed to copy link', null, {
        isPersistent: false,
      })
    }
  }

  // Format creation date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // Get author initials
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
        <p className='text-muted-foreground'>{template.long_description}</p>
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
      </div>
    </div>
  )
}
