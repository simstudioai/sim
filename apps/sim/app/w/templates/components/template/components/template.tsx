'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useSidebarStore } from '@/stores/sidebar/store'
import { TemplateHero } from './template-hero/template-hero'
import { TemplatePreview } from './template-preview/template-preview'
import { TemplateDescription } from './template-description/template-description'
import { SimilarTemplates } from './similar-templates/similar-templates'

const logger = createLogger('TemplateDetailPage')

interface TemplateData {
  id: string
  workflowId: string
  name: string
  description: string
  authorName: string
  views: number
  category: string
  createdAt: string
  updatedAt: string
  workflowState?: {
    blocks: Record<string, any>
    edges: Array<{
      id: string
      source: string
      target: string
      sourceHandle?: string
      targetHandle?: string
    }>
    loops: Record<string, any>
  }
}

interface TemplateDetailPageProps {
  templateId: string
  onBack?: () => void
}

export function TemplateDetailPage({ templateId, onBack }: TemplateDetailPageProps) {
  const router = useRouter()
  const [template, setTemplate] = useState<TemplateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Get sidebar state for layout calculations
  const { mode, isExpanded } = useSidebarStore()
  
  // Calculate if sidebar is collapsed based on mode and state
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  // Fetch template data
  useEffect(() => {
    const fetchTemplate = async () => {
      try {
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
        
        logger.info(`Loaded template: ${data.name}`)

        // Track the view using the new view endpoint
        try {
          await fetch(`/api/templates/${templateId}/view`, {
            method: 'POST',
          })
        } catch (viewError) {
          // Don't fail the page load if view tracking fails
          logger.warn('Failed to track template view:', viewError)
        }
      } catch (err) {
        logger.error('Error fetching template:', err)
        setError('Failed to load template')
      } finally {
        setLoading(false)
      }
    }

    fetchTemplate()
  }, [templateId])

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
          {/* Left Column - Hero and Description */}
          <div className="space-y-8">
            <TemplateHero template={template} />
            <TemplateDescription template={template} />
          </div>
          
          {/* Right Column - Preview */}
          <div>
            <TemplatePreview template={template} />
          </div>
        </div>

        {/* Similar Templates Section */}
        <SimilarTemplates currentTemplate={template} />
      </div>
    </div>
  )
} 