'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useSidebarStore } from '@/stores/sidebar/store'
import { NotificationList } from '../../../[id]/components/notifications/notifications'
import { TemplateHero } from './components/template-hero/template-hero'
import { TemplatePreview } from './components/template-preview/template-preview'
import { SimilarTemplates } from './components/similar-templates/similar-templates'
import { TemplateData } from '../../types'

const logger = createLogger('TemplateDetailPage')

interface TemplateDetailPageProps {
  templateId: string
  initialTemplateData?: TemplateData | null
  onBack?: () => void
}

export function TemplateDetailPage({ templateId, initialTemplateData, onBack }: TemplateDetailPageProps) {
  const router = useRouter()
  const [template, setTemplate] = useState<TemplateData | null>(initialTemplateData || null)
  const [loading, setLoading] = useState(!initialTemplateData) // Only show loading if we don't have initial data
  const [error, setError] = useState<string | null>(null)
  
  // Get sidebar state for layout calculations
  const { mode, isExpanded } = useSidebarStore()
  
  // Calculate if sidebar is collapsed based on mode and state
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  // Fetch template data only if we don't have it or if we need to ensure we have complete data
  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        // If we have initial data and it includes workflowState, we might not need to fetch
        if (initialTemplateData?.workflowState) {
          setTemplate(initialTemplateData)
          setLoading(false)
          trackView(templateId)
          return
        }

        setLoading(true)
        setError(null)

        // Use the new organized API endpoint
        const response = await fetch(
          `/api/templates/${templateId}/info?includeState=true`
        )

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
        
        // Track view after successful load
        trackView(templateId)
                
      } catch (err) {
        logger.error('Error fetching template:', err)
        setError('Failed to load template')
      } finally {
        setLoading(false)
      }
    }

    fetchTemplate()
  }, [templateId, initialTemplateData])

  // Track template view - non-blocking and handles errors gracefully
  const trackView = async (id: string) => {
    try {
      await fetch(`/api/templates/${id}/view`, {
        method: 'POST',
      })
      logger.info(`Tracked view for template: ${id}`)
    } catch (error) {
      // Don't let view tracking errors affect the user experience
      logger.warn('Failed to track template view:', error)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className={`flex h-screen items-center justify-center transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}>
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading template...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !template) {
    return (
      <div className={`flex h-screen items-center justify-center transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {error === 'Template not found' ? 'Template Not Found' : 'Error Loading Template'}
          </h1>
          <p className="text-muted-foreground mb-4">
            {error === 'Template not found' 
              ? 'The template you\'re looking for doesn\'t exist or has been removed.'
              : 'There was an error loading this template. Please try again.'
            }
          </p>
          <Button 
            variant="outline" 
            onClick={() => onBack ? onBack() : router.push('/w/templates')}
            className="mr-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Templates
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}>
      {/* Header with back button */}
      <div className="border-b bg-background">
        <div className="px-6 py-4">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => onBack ? onBack() : router.push('/w/templates')}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Templates
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="px-6 py-8">
        {/* Hero and Preview Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Left Column - Hero */}
          <div className="space-y-8">
            <TemplateHero template={template} />
          </div>
          
          {/* Right Column - Preview */}
          <div>
            <TemplatePreview template={template} />
          </div>
        </div>

        {/* Similar Templates Section - This loads independently and won't block the main content */}
        <SimilarTemplates currentTemplate={template} />
      </div>
      
      {/* Notifications */}
      <NotificationList />
    </div>
  )
} 