'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Heart, Loader2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useSidebarStore } from '@/stores/sidebar/store'
import { NotificationList } from '../../../[id]/components/notifications/notifications'
import type { TemplateData } from '../../types'
import { PublishedModal } from '../control-bar/components/published-modal'
import { SavedModal } from '../control-bar/components/saved-modal'
import { SimilarTemplates } from './components/similar-templates/similar-templates'
import { TemplateHero } from './components/template-hero/template-hero'
import { TemplatePreview } from './components/template-preview/template-preview'

const logger = createLogger('TemplateDetailPage')

interface TemplateDetailPageProps {
  templateId: string
  initialTemplateData?: TemplateData | null
  onBack?: () => void
}

export function TemplateDetailPage({
  templateId,
  initialTemplateData,
  onBack,
}: TemplateDetailPageProps) {
  const router = useRouter()
  const [template, setTemplate] = useState<TemplateData | null>(initialTemplateData || null)
  const [loading, setLoading] = useState(!initialTemplateData)
  const [error, setError] = useState<string | null>(null)
  const [savedModalOpen, setSavedModalOpen] = useState(false)
  const [publishedModalOpen, setPublishedModalOpen] = useState(false)

  const { mode, isExpanded } = useSidebarStore()

  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  // Reset body pointer-events when template page loads
  useEffect(() => {
    const resetBodyPointerEvents = () => {
      const currentBodyStyle = getComputedStyle(document.body).pointerEvents
      if (currentBodyStyle === 'none') {
        document.body.style.pointerEvents = 'auto'
      }
    }
    resetBodyPointerEvents()
  }, [])

  useEffect(() => {
    // Don't set loading if we have valid initial data
    if (!initialTemplateData) {
      setLoading(true)
    }

    setError(null)
    setSavedModalOpen(false)
    setPublishedModalOpen(false)

    const fetchTemplate = async () => {
      if (initialTemplateData?.workflowState) {
        setTemplate(initialTemplateData)
        if (loading) setLoading(false)
        trackView(templateId)
        return
      }

      if (!template || template.id !== templateId) {
        setLoading(true)

        try {
          const response = await fetch(`/api/templates/${templateId}/info?includeState=true`)

          if (!response.ok) {
            if (response.status === 404) {
              setError('Template not found')
            } else {
              setError('Failed to load template')
            }
            return
          }

          const data = await response.json()
          setTemplate(data)

          trackView(templateId)
        } catch (err) {
          logger.error('Error fetching template:', err)
          setError('Failed to load template')
        } finally {
          setLoading(false)
        }
      }
    }

    fetchTemplate()
  }, [templateId]) // Remove initialTemplateData from deps

  const trackView = async (id: string) => {
    try {
      await fetch(`/api/templates/${id}/view`, {
        method: 'POST',
      })
    } catch (error) {
      logger.warn('Failed to track template view:', error)
    }
  }

  if (loading) {
    return (
      <div
        className={`flex h-screen items-center justify-center transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        <div className='flex items-center space-x-2'>
          <Loader2 className='h-4 w-4 animate-spin' />
          <span className='text-muted-foreground text-sm'>Loading template...</span>
        </div>
      </div>
    )
  }

  if (error || !template) {
    return (
      <div
        className={`flex h-screen items-center justify-center transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        <div className='text-center'>
          <h1 className='mb-2 font-bold text-2xl text-foreground'>
            {error === 'Template not found' ? 'Template Not Found' : 'Error Loading Template'}
          </h1>
          <p className='mb-4 text-muted-foreground'>
            {error === 'Template not found'
              ? "The template you're looking for doesn't exist or has been removed."
              : 'There was an error loading this template. Please try again.'}
          </p>
          <Button
            variant='outline'
            onClick={() => (onBack ? onBack() : router.push('/w/templates'))}
            className='mr-2'
          >
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back to Templates
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`min-h-screen transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      <div className='w-full border-b bg-background'>
        {/* Top Row - Action Icons */}
        <div className='flex justify-between px-6 py-4'>
          <div className='flex items-center gap-2'>
            <span
              className='cursor-pointer font-medium text-sm'
              onClick={() => router.push('/w/templates')}
            >
              <ArrowLeft className='mr-2 inline h-4 w-4' />
              Back to templates
            </span>
          </div>
          <div className='flex items-center gap-6'>
            <span
              className='cursor-pointer font-medium text-sm'
              onClick={() => setSavedModalOpen(true)}
            >
              <Heart className='mr-2 inline h-4 w-4' />
              Saved
            </span>
            <span
              className='cursor-pointer font-medium text-sm'
              onClick={() => setPublishedModalOpen(true)}
            >
              <Upload className='mr-2 inline h-4 w-4' />
              Published
            </span>
          </div>
        </div>
      </div>

      <div className='px-6 py-8'>
        <div className='mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2'>
          <div className='space-y-8'>
            <TemplateHero template={template} />
          </div>

          <div>
            <TemplatePreview template={template} />
          </div>
        </div>

        <SimilarTemplates currentTemplate={template} />
      </div>

      {/* Notifications */}
      <NotificationList />

      {/* Saved Templates Modal */}
      <SavedModal open={savedModalOpen} onOpenChange={setSavedModalOpen} />

      {/* Published Templates Modal */}
      <PublishedModal open={publishedModalOpen} onOpenChange={setPublishedModalOpen} />
    </div>
  )
}
