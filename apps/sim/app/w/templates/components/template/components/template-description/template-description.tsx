'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, Eye, Tag } from 'lucide-react'
import { getCategoryLabel, getCategoryColor, getCategoryIcon } from '../../../../constants/categories'

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

interface TemplateDescriptionProps {
  template: TemplateData
}

export function TemplateDescription({ template }: TemplateDescriptionProps) {
  // Format dates
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // Calculate workflow stats from state
  const getWorkflowStats = () => {
    if (!template.workflowState) {
      return { blockCount: 0, connectionCount: 0 }
    }

    const blockCount = Object.keys(template.workflowState.blocks || {}).length
    const connectionCount = (template.workflowState.edges || []).length

    return { blockCount, connectionCount }
  }

  const { blockCount, connectionCount } = getWorkflowStats()
  const categoryColor = getCategoryColor(template.category)
  const categoryIcon = getCategoryIcon(template.category)

  return (
    <div className="space-y-6">
      {/* About This Template */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About This Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium text-sm text-muted-foreground mb-2">Description</h4>
            <p className="text-sm leading-relaxed">
              {template.description || 'No description provided for this template.'}
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-sm text-muted-foreground mb-1">Workflow Blocks</h4>
              <p className="text-lg font-semibold">{blockCount}</p>
            </div>
            <div>
              <h4 className="font-medium text-sm text-muted-foreground mb-1">Connections</h4>
              <p className="text-lg font-semibold">{connectionCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Template Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Category */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Category</span>
            <Badge 
              variant="outline" 
              className="flex items-center"
              style={{
                borderColor: categoryColor,
                color: categoryColor,
              }}
            >
              {categoryIcon}
              {getCategoryLabel(template.category)}
            </Badge>
          </div>

          {/* Views */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Views</span>
            <div className="flex items-center space-x-1">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{template.views.toLocaleString()}</span>
            </div>
          </div>

          {/* Created Date */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Created</span>
            <div className="flex items-center space-x-1">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{formatDate(template.createdAt)}</span>
            </div>
          </div>

          {/* Last Updated */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Last Updated</span>
            <div className="flex items-center space-x-1">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{formatDate(template.updatedAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Use Cases (Placeholder for future enhancement) */}
      {/* TODO: Add tags for use cases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Perfect For</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Automating {getCategoryLabel(template.category).toLowerCase()} workflows</span>
            </div>
            <div className="flex items-center space-x-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Getting started with workflow automation</span>
            </div>
            <div className="flex items-center space-x-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Learning best practices</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 