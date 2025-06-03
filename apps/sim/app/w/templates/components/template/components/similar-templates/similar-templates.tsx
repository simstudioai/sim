'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TemplateWorkflowCard } from '../../../../components/template-workflow-card'
import { WorkflowCardSkeleton } from '@/app/w/templates/components/workflow-card-skeleton'
import { createLogger } from '@/lib/logs/console-logger'
import { TemplateData, getTemplateDescription } from '../../../../types'

const logger = createLogger('SimilarTemplates')

interface SimilarTemplatesProps {
  currentTemplate: TemplateData
}

export function SimilarTemplates({ currentTemplate }: SimilarTemplatesProps) {
  const router = useRouter()
  const [similarTemplates, setSimilarTemplates] = useState<TemplateData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchSimilarTemplates = async () => {
      try {
        setLoading(true)
        setError(null)

        // Use the new organized API endpoint for similar templates
        const response = await fetch(
          `/api/templates/${currentTemplate.id}/similar?limit=4`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch similar templates')
        }

        const data = await response.json()
        
        // Extract similar templates from the new API response format
        const similarTemplatesData = data.similarTemplates || []

        setSimilarTemplates(similarTemplatesData)
        
        logger.info(`Loaded ${similarTemplatesData.length} similar templates for category: ${currentTemplate.category}`)
      } catch (err) {
        logger.error('Error fetching similar templates:', err)
        setError('Failed to load similar templates')
      } finally {
        setLoading(false)
      }
    }

    fetchSimilarTemplates()
  }, [currentTemplate.id, currentTemplate.category])

  // Convert template data to workflow format expected by WorkflowCard
  const convertToWorkflowFormat = (template: TemplateData) => ({
    id: template.id,
    name: template.name,
    description: getTemplateDescription(template),
    author: template.authorName,
    views: template.views,
    tags: [template.category || 'uncategorized'],
    workflowState: template.workflowState,
    workflowUrl: `/w/templates/${template.id}`, // Navigate to template detail page
    price: template.price || 'Free',
  })

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Similar Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <WorkflowCardSkeleton key={`skeleton-${index}`} />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || similarTemplates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Similar Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              {error ? 'Failed to load similar templates' : 'No similar templates found'}
            </p>
            <Button 
              variant="outline" 
              onClick={() => router.push('/w/templates')}
            >
              Browse All Templates
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl">Similar Templates</CardTitle>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => router.push(`/w/templates?category=${currentTemplate.category}`)}
        >
          View All
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {similarTemplates.map((template) => (
            <TemplateWorkflowCard
              key={template.id}
              workflow={convertToWorkflowFormat(template)}
              index={0}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
} 