'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { CATEGORY_GROUPS, getCategoryLabel } from '../../../../constants/categories'
import { getTemplateDescription, type TemplateData, type Workflow } from '../../../../types'
import { Section } from '../../../section'
import { CategoryPageLayout } from '../../../shared/category-page-layout'
import { TemplateGrid } from '../../../shared/template-grid'

const logger = createLogger('OperationsPage')

export default function OperationsPage() {
  const searchParams = useSearchParams()
  const subcategory = searchParams.get('subcategory')

  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [templateData, setTemplateData] = useState<Record<string, TemplateData[]>>({})
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Create refs for each section
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)

  // Convert template data to the format expected by components
  const workflowData = useMemo(() => {
    const result: Record<string, Workflow[]> = {}

    Object.entries(templateData).forEach(([category, items]) => {
      result[category] = items.map((item) => ({
        id: item.id,
        name: item.name,
        description: getTemplateDescription(item),
        author: item.authorName,
        views: item.views,
        tags: [item.category || 'uncategorized'],
        workflowState: item.workflowState,
        workflowUrl: `/w/${item.workflowId}`,
        price: item.price || 'Free',
      }))
    })

    return result
  }, [templateData])

  // Filter workflows based on search query and subcategory
  const filteredWorkflows = useMemo(() => {
    let dataToFilter = workflowData

    // Apply subcategory filter if set
    if (subcategory && dataToFilter[subcategory]) {
      dataToFilter = { [subcategory]: dataToFilter[subcategory] }
    }

    // Apply search filter
    if (!searchQuery.trim()) {
      return dataToFilter
    }

    const query = searchQuery.toLowerCase()
    const searchFiltered: Record<string, Workflow[]> = {}

    Object.entries(dataToFilter).forEach(([category, workflows]) => {
      const matchingWorkflows = workflows.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(query) ||
          workflow.description.toLowerCase().includes(query) ||
          workflow.author.toLowerCase().includes(query) ||
          workflow.tags.some((tag) => tag.toLowerCase().includes(query))
      )

      if (matchingWorkflows.length > 0) {
        searchFiltered[category] = matchingWorkflows
      }
    })

    return searchFiltered
  }, [searchQuery, workflowData, subcategory])

  // Fetch operations templates
  useEffect(() => {
    const fetchOperationsData = async () => {
      try {
        setLoading(true)

        // Fetch all templates for operations subcategories
        const categoriesQuery = CATEGORY_GROUPS.operations.join(',')
        const response = await fetch(
          `/api/templates/workflows?category=${categoriesQuery}&includeState=true`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch operations templates')
        }

        const data = await response.json()

        // Handle different possible response formats
        let templates: TemplateData[] = []

        if (Array.isArray(data)) {
          // Direct array response
          templates = data
        } else if (data.byCategory) {
          // Structured response with byCategory
          templates = Object.values(data.byCategory).flat() as TemplateData[]
        } else if (data.templates) {
          // Response with templates property
          templates = data.templates
        } else {
          logger.error('Unexpected API response format:', data)
          throw new Error('Unexpected API response format')
        }

        // Organize by subcategory
        const organizedData: Record<string, TemplateData[]> = {}
        CATEGORY_GROUPS.operations.forEach((cat) => {
          organizedData[cat] = templates.filter((item: TemplateData) => item.category === cat)
        })

        setTemplateData(organizedData)

        // Set initial active section
        if (subcategory && CATEGORY_GROUPS.operations.includes(subcategory as any)) {
          setActiveSection(subcategory)
        } else {
          setActiveSection(CATEGORY_GROUPS.operations[0])
        }

        setLoading(false)
      } catch (error) {
        logger.error('Error fetching operations templates:', error)
        setError('Failed to load operations templates. Please try again later.')
        setLoading(false)
      }
    }

    fetchOperationsData()
  }, [subcategory])

  // Scroll to section
  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  // Handle category filter (not used on category pages)
  const handleCategoryFilter = () => {
    // No-op for category pages
  }

  return (
    <CategoryPageLayout
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      activeSection={activeSection}
      scrollToSection={scrollToSection}
      onCategoryFilter={handleCategoryFilter}
      error={error}
      mainCategory='operations'
    >
      {loading ? (
        <TemplateGrid isLoading={true} skeletonCount={6} />
      ) : (
        <>
          {Object.entries(filteredWorkflows).map(([category, workflows]) => (
            <Section
              key={category}
              id={category}
              title={getCategoryLabel(category)}
              ref={(el) => {
                if (el) {
                  sectionRefs.current[category] = el
                }
              }}
            >
              <TemplateGrid
                workflows={workflows}
                emptyMessage={`No ${getCategoryLabel(category).toLowerCase()} templates available`}
              />
            </Section>
          ))}

          {Object.keys(filteredWorkflows).length === 0 && !loading && (
            <div className='flex h-64 flex-col items-center justify-center'>
              <AlertCircle className='mb-4 h-8 w-8 text-muted-foreground' />
              <p className='text-muted-foreground'>
                No operations templates found matching your search.
              </p>
            </div>
          )}
        </>
      )}
    </CategoryPageLayout>
  )
}
