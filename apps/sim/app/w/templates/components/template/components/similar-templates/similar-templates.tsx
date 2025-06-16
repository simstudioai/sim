'use client'

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console-logger'
import { getTemplateDescription, type TemplateData } from '../../../../types'
import { TemplateGrid } from '../../../components/template-grid'

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
        const response = await fetch(`/api/templates/${currentTemplate.id}/similar?limit=4`)

        if (!response.ok) {
          throw new Error('Failed to fetch similar templates')
        }

        const data = await response.json()

        // Extract similar templates from the new API response format
        const similarTemplatesData = data.similarTemplates || []

        setSimilarTemplates(similarTemplatesData)

        logger.info(
          `Loaded ${similarTemplatesData.length} similar templates for category: ${currentTemplate.category}`
        )
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

  const workflows = similarTemplates.map(convertToWorkflowFormat)

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle className='text-xl'>Similar Templates</CardTitle>
        {!loading && workflows.length > 0 && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => router.push(`/w/templates?category=${currentTemplate.category}`)}
          >
            View All
            <ArrowRight className='ml-2 h-4 w-4' />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <TemplateGrid
          workflows={workflows}
          isLoading={loading}
          emptyMessage={error ? 'Failed to load similar templates' : 'No similar templates found'}
          skeletonCount={4}
          columns={{ md: 2, lg: 4 }}
        />
        {(error || (!loading && workflows.length === 0)) && (
          <div className='mt-4 text-center'>
            <Button variant='outline' onClick={() => router.push('/w/templates')}>
              Browse All Templates
              <ArrowRight className='ml-2 h-4 w-4' />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
