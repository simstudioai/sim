'use client'

import { useState } from 'react'
import { Eye, Heart, Share2, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getCategoryLabel, getCategoryColor, getCategoryIcon } from '../../../../constants/categories'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TemplateHero')

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

interface TemplateHeroProps {
  template: TemplateData
}

export function TemplateHero({ template }: TemplateHeroProps) {
  const router = useRouter()
  const { createWorkflow } = useWorkflowRegistry()
  const [isUsing, setIsUsing] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  // Handle using the template
  const handleUseTemplate = async () => {
    try {
      setIsUsing(true)

      // Track view using the correct template view endpoint
      await fetch(`/api/templates/${template.id}/view`, {
        method: 'POST',
      })

      // Create a local copy of the template workflow
      if (template.workflowState) {
        const newWorkflowId = createWorkflow({
          name: `${template.name} (Copy)`,
          description: template.description,
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

  // Handle saving template (placeholder)
  const handleSaveTemplate = () => {
    setIsSaved(!isSaved)
    // TODO: Implement save functionality
  }

  // Handle sharing template (placeholder)
  const handleShareTemplate = () => {
    navigator.clipboard.writeText(window.location.href)
    // TODO: Show toast notification
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
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const categoryColor = getCategoryColor(template.category)
  const categoryIcon = getCategoryIcon(template.category)

  return (
    <div className="space-y-6">
      {/* Category Badge */}
      <div>
        <Badge 
          variant="outline" 
          className="flex items-center w-fit"
          style={{
            borderColor: categoryColor,
            color: categoryColor,
          }}
        >
          {categoryIcon}
          {getCategoryLabel(template.category)}
        </Badge>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {template.name}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          {template.description}
        </p>
      </div>

      {/* Author and Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground">
              {getAuthorInitials(template.authorName)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {template.authorName}
            </p>
            <p className="text-xs text-muted-foreground">
              Created {formatDate(template.createdAt)}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-1 text-muted-foreground">
          <Eye className="h-4 w-4" />
          <span className="text-sm">{template.views.toLocaleString()}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button 
          onClick={handleUseTemplate}
          disabled={isUsing || !template.workflowState}
          className="flex-1 sm:flex-none"
        >
          {isUsing ? (
            <>
              <Download className="mr-2 h-4 w-4 animate-pulse" />
              Creating...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Use This Template
            </>
          )}
        </Button>
        
        <Button 
          variant="outline" 
          size="default"
          onClick={handleSaveTemplate}
          className={isSaved ? 'bg-accent' : ''}
        >
          <Heart className={`mr-2 h-4 w-4 ${isSaved ? 'fill-current' : ''}`} />
          {isSaved ? 'Saved' : 'Save'}
        </Button>
        
        <Button 
          variant="outline" 
          size="default"
          onClick={handleShareTemplate}
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      </div>
    </div>
  )
} 