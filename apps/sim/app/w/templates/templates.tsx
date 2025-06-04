'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { TemplatesHeader } from './components/control-bar/control-bar'
import { ErrorMessage } from './components/error-message'
import { Section } from './components/section'
import { TemplateWorkflowCard } from './components/template-workflow-card'
import { WorkflowCardSkeleton } from './components/workflow-card-skeleton'
import { TemplateGrid } from './components/shared/template-grid'
import { CATEGORIES, getCategoryLabel, CATEGORY_GROUPS } from './constants/categories'
import { useSidebarStore } from '@/stores/sidebar/store'
import { createLogger } from '@/lib/logs/console-logger'
import { Workflow, TemplateData, TemplateCollection, getTemplateDescription } from './types'

const logger = createLogger('Templates')

// Alias for backward compatibility
export type TemplateWorkflow = TemplateData

// The order to display sections in, matching toolbar order
const SECTION_ORDER = ['popular', ...CATEGORIES.map((cat) => cat.value)]

export default function Templates() {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [templateData, setTemplateData] = useState<TemplateCollection>({
    popular: [],
    byCategory: {},
  })
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set(['popular']))
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null)

  // Get sidebar state for layout calculations
  const { mode, isExpanded } = useSidebarStore()
  
  // Calculate if sidebar is collapsed based on mode and state
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  // Create refs for each section
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)
  const initialFetchCompleted = useRef(false)

  // Convert template data to the format expected by components
  const workflowData = useMemo(() => {
    // Reusable function to convert template items to workflow format
    const convertTemplateItems = (items: any[]) => 
      items.map((item) => ({
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

    const result: Record<string, Workflow[]> = {
      popular: convertTemplateItems(templateData.popular),
    }

    // Add categories that have been loaded
    Object.entries(templateData.byCategory).forEach(([category, items]) => {
      result[category] = convertTemplateItems(items || [])
    })

    return result
  }, [templateData])

  // Filter workflows based on search query and category filter
  const filteredWorkflows = useMemo(() => {
    let dataToFilter = workflowData

    // Apply category filter if set
    if (categoryFilter && categoryFilter.length > 0) {
      const filtered: Record<string, Workflow[]> = {}
      
      // Always include popular if it exists
      if (dataToFilter.popular) filtered.popular = dataToFilter.popular
      
      // Add filtered categories
      categoryFilter.forEach(category => {
        if (dataToFilter[category]) {
          filtered[category] = dataToFilter[category]
        }
      })
      
      dataToFilter = filtered
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
  }, [searchQuery, workflowData, categoryFilter])

  // Sort sections according to the toolbar order
  const sortedFilteredWorkflows = useMemo(() => {
    // Get entries from filteredWorkflows
    const entries = Object.entries(filteredWorkflows)

    // Sort based on the SECTION_ORDER
    entries.sort((a, b) => {
      const indexA = SECTION_ORDER.indexOf(a[0])
      const indexB = SECTION_ORDER.indexOf(b[0])

      // If both categories are in our predefined order, use that order
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB
      }

      // If only one category is in our order, prioritize it
      if (indexA !== -1) return -1
      if (indexB !== -1) return 1

      // Otherwise, alphabetical order
      return a[0].localeCompare(b[0])
    })

    return entries
  }, [filteredWorkflows])

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true)

        // Load limited templates for discover page - 9 for popular, 6 for categories
        const response = await fetch('/api/templates/workflows?section=popular,byCategory&limit=6&popularLimit=9')

        if (!response.ok) {
          throw new Error('Failed to fetch template data')
        }

        const data = await response.json()

        // Mark all sections as loaded
        const allSections = new Set(['popular', ...CATEGORIES.map(cat => cat.value)])
        setLoadedSections(allSections)

        setTemplateData(data)
        initialFetchCompleted.current = true

        // Set initial active section to popular
        setActiveSection('popular')
        setLoading(false)
      } catch (error) {
        logger.error('Error fetching templates:', error)
        setError('Failed to load templates. Please try again later.')
        setLoading(false)
      }
    }

    fetchInitialData()
  }, [])

  // Simplify scrollToSection
  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  // Simplified intersection observer just for tracking active section
  useEffect(() => {
    if (!initialFetchCompleted.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first intersecting section and set it as active
        const intersectingEntry = entries.find(entry => entry.isIntersecting)
        if (intersectingEntry) {
          setActiveSection(intersectingEntry.target.id)
        }
      },
      {
        root: contentRef.current,
        rootMargin: '-20% 0px -60% 0px', // Only consider section active when it's prominently visible
        threshold: 0.1,
      }
    )

    // Observe all sections
    Object.entries(sectionRefs.current).forEach(([id, ref]) => {
      if (ref) {
        observer.observe(ref)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [initialFetchCompleted.current])


  return (
    <div className={`flex h-[100vh] w-full max-w-[100vw] overflow-x-hidden flex-col transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}>
      {/* Templates Header */}
      <TemplatesHeader
        setSearchQuery={setSearchQuery}
        activeSection={activeSection}
        scrollToSection={scrollToSection}
        onCategoryFilter={setCategoryFilter}
      />

      {/* Main content */}
      <div ref={contentRef} className='flex-1 overflow-y-auto px-6 py-6 pb-16'>
        {/* Error message */}
        <ErrorMessage message={error} />

        {/* Loading state */}
        {loading && (
          <Section
            id='loading'
            title='Popular'
            ref={(el) => {
              sectionRefs.current.loading = el
            }}
          >
            <TemplateGrid isLoading={true} skeletonCount={6} />
          </Section>
        )}

        {/* Render template sections */}
        {!loading && (
          <>
            {sortedFilteredWorkflows.map(
              ([category, workflows]) => {
                // Determine if we should show Browse All button
                // Popular should never show Browse All
                // Other categories should show Browse All with their specific category name
                const showBrowseAll = category !== 'popular' && !searchQuery.trim()
                
                // Show sections if they have workflows OR if no search is active (to allow empty sections to trigger loading)
                const shouldShowSection = workflows.length > 0 || !searchQuery.trim()
                
                return shouldShowSection && (
                  <Section
                    key={category}
                    id={category}
                    title={getCategoryLabel(category)}
                    showBrowseAll={showBrowseAll}
                    browseAllCategory={category}
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
                )
              }
            )}

            {sortedFilteredWorkflows.length === 0 && !loading && (
              <div className='flex h-64 flex-col items-center justify-center'>
                <AlertCircle className='mb-4 h-8 w-8 text-muted-foreground' />
                <p className='text-muted-foreground'>No templates found matching your search.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}