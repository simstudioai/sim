'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { TemplatesHeader } from './components/control-bar/control-bar'
import { ErrorMessage } from '@/app/w/marketplace/components/error-message'
import { Section } from '@/app/w/marketplace/components/section'
import { TemplateWorkflowCard } from './components/template-workflow-card'
import { WorkflowCardSkeleton } from '@/app/w/marketplace/components/workflow-card-skeleton'
import { CATEGORIES, getCategoryLabel } from './constants/categories'
import { useSidebarStore } from '@/stores/sidebar/store'
import { createLogger } from '@/lib/logs/console-logger'
import { TemplateDetailPage } from './components/template/components/template'

const logger = createLogger('Templates')

// Types
export interface Workflow {
  id: string
  name: string
  description: string
  author: string
  views: number
  tags: string[]
  thumbnail?: string
  workflowUrl: string
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

// Updated interface to match API response format
export interface TemplateWorkflow {
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

export interface TemplateData {
  popular: TemplateWorkflow[]
  recent: TemplateWorkflow[]
  byCategory: Record<string, TemplateWorkflow[]>
}

// The order to display sections in, matching toolbar order
const SECTION_ORDER = ['popular', 'recent', ...CATEGORIES.map((cat) => cat.value)]

export default function Templates() {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [templateData, setTemplateData] = useState<TemplateData>({
    popular: [],
    recent: [],
    byCategory: {},
  })
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set(['popular', 'recent']))
  const [_visibleSections, setVisibleSections] = useState<Set<string>>(new Set(['popular']))
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null)
  
  // New state for handling template detail view
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')

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
    const result: Record<string, Workflow[]> = {
      popular: templateData.popular.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: item.authorName,
        views: item.views,
        tags: [item.category],
        workflowState: item.workflowState,
        workflowUrl: `/w/${item.workflowId}`,
      })),
      recent: templateData.recent.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: item.authorName,
        views: item.views,
        tags: [item.category],
        workflowState: item.workflowState,
        workflowUrl: `/w/${item.workflowId}`,
      })),
    }

    // Add entries for each category
    Object.entries(templateData.byCategory).forEach(([category, items]) => {
      if (items && items.length > 0) {
        result[category] = items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || '',
          author: item.authorName,
          views: item.views,
          tags: [item.category],
          workflowState: item.workflowState,
          workflowUrl: `/w/${item.workflowId}`,
        }))
      }
    })

    return result
  }, [templateData])

  // Filter workflows based on search query and category filter
  const filteredWorkflows = useMemo(() => {
    let dataToFilter = workflowData

    // Apply category filter if set
    if (categoryFilter && categoryFilter.length > 0) {
      const filtered: Record<string, Workflow[]> = {}
      
      // Always include popular and recent if they exist
      if (dataToFilter.popular) filtered.popular = dataToFilter.popular
      if (dataToFilter.recent) filtered.recent = dataToFilter.recent
      
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

  // Fetch templates on component mount - improved to include state initially
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true)

        // Fetch ONLY popular and recent initially - no categories, no state
        const response = await fetch(
          '/api/templates/workflows?section=popular,recent&limit=6'
        )

        if (!response.ok) {
          throw new Error('Failed to fetch template data')
        }

        const data = await response.json()

        // Set initial loaded sections
        setLoadedSections(new Set(['popular', 'recent']))

        logger.info(
          'Initial template data loaded:',
          data.popular?.length || 0,
          'popular,',
          data.recent?.length || 0,
          'recent'
        )

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

  // Lazy load category data when sections become visible
  const loadCategoryData = async (categoryName: string) => {
    if (loadedSections.has(categoryName)) {
      return // Already loaded, no need to fetch again
    }

    try {
      setLoadedSections((prev) => new Set([...prev, categoryName]))

      logger.info(`Loading category: ${categoryName}`) // Debug

      // Load category data WITHOUT state initially for performance
      const response = await fetch(
        `/api/templates/workflows?category=${categoryName}&limit=6`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch ${categoryName} category data`)
      }

      const data = await response.json()

      // Debug logging
      logger.info(
        'Category data received:',
        data.byCategory ? Object.keys(data.byCategory) : 'No byCategory',
        data.byCategory?.[categoryName]?.length || 0
      )

      // Check if we received any data in the category
      if (
        !data.byCategory ||
        !data.byCategory[categoryName] ||
        data.byCategory[categoryName].length === 0
      ) {
        logger.warn(`No items found for category: ${categoryName}`)
      }

      setTemplateData((prev) => ({
        ...prev,
        byCategory: {
          ...prev.byCategory,
          [categoryName]: data.byCategory?.[categoryName] || [],
        },
      }))
    } catch (error) {
      logger.error(`Error fetching ${categoryName} category:`, error)
      // We don't set a global error, just log it
    }
  }

  // Function to mark a template as needing state and fetch it if not available
  const ensureWorkflowState = async (workflowId: string) => {
    try {
      // Find which section contains this template
      let foundWorkflow: TemplateWorkflow | undefined

      // Check in popular section
      foundWorkflow = templateData.popular.find((w) => w.id === workflowId)

      // Check in recent section if not found
      if (!foundWorkflow) {
        foundWorkflow = templateData.recent.find((w) => w.id === workflowId)
      }

      // Check in category sections if not found
      if (!foundWorkflow) {
        for (const category of Object.keys(templateData.byCategory)) {
          foundWorkflow = templateData.byCategory[category].find((w) => w.id === workflowId)
          if (foundWorkflow) break
        }
      }

      // If we have the template but it doesn't have state, fetch it
      if (foundWorkflow && !foundWorkflow.workflowState) {
        const response = await fetch(
          `/api/templates/workflows?templateId=${workflowId}&includeState=true`
        )

        if (response.ok) {
          const data = await response.json()

          // Update the template data with the state
          setTemplateData((prevData) => {
            const updatedData = { ...prevData }

            // Helper function to update template in a section
            const updateWorkflowInSection = (workflows: TemplateWorkflow[]) => {
              return workflows.map((w) =>
                w.id === workflowId
                  ? {
                      ...w,
                      workflowState: data.workflowState, // Use direct property from API response
                    }
                  : w
              )
            }

            // Update in popular
            updatedData.popular = updateWorkflowInSection(updatedData.popular)

            // Update in recent
            updatedData.recent = updateWorkflowInSection(updatedData.recent)

            // Update in categories
            Object.keys(updatedData.byCategory).forEach((category) => {
              updatedData.byCategory[category] = updateWorkflowInSection(
                updatedData.byCategory[category]
              )
            })

            return updatedData
          })
        }
      }
    } catch (error) {
      logger.error(`Error ensuring template state for ${workflowId}:`, error)
    }
  }

  // Function to scroll to a specific section
  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      // Load the section data if not already loaded
      if (!loadedSections.has(sectionId) && sectionId !== 'popular' && sectionId !== 'recent') {
        loadCategoryData(sectionId)
      }

      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  // Setup intersection observer to track active section and load sections as they become visible
  useEffect(() => {
    if (!initialFetchCompleted.current) return

    // Function to get current section IDs in their display order
    const getCurrentSectionIds = () => {
      return Object.keys(filteredWorkflows).filter(
        (key) => filteredWorkflows[key] && filteredWorkflows[key].length > 0
      )
    }

    // Create intersection observer to detect when sections enter viewport
    const observeSections = () => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const sectionId = entry.target.id

            // Update visibility tracking
            if (entry.isIntersecting) {
              setVisibleSections((prev) => {
                const updated = new Set(prev)
                updated.add(sectionId)
                return updated
              })

              // Load category data if section is visible and not loaded yet
              if (
                !loadedSections.has(sectionId) &&
                sectionId !== 'popular' &&
                sectionId !== 'recent'
              ) {
                loadCategoryData(sectionId)
              }
            } else {
              setVisibleSections((prev) => {
                const updated = new Set(prev)
                updated.delete(sectionId)
                return updated
              })
            }
          })
        },
        {
          root: contentRef.current,
          rootMargin: '200px 0px', // Load sections slightly before they become visible
          threshold: 0.1,
        }
      )

      // Observe all sections
      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (ref) {
          observer.observe(ref)
        }
      })

      return observer
    }

    const observer = observeSections()

    // Use a single source of truth for determining the active section
    const determineActiveSection = () => {
      if (!contentRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = contentRef.current
      const viewportTop = scrollTop
      const viewportMiddle = viewportTop + clientHeight / 2
      const viewportBottom = scrollTop + clientHeight
      const isAtBottom = viewportBottom >= scrollHeight - 50
      const isAtTop = viewportTop <= 20

      const currentSectionIds = getCurrentSectionIds()

      // Handle edge cases first
      if (isAtTop && currentSectionIds.length > 0) {
        setActiveSection(currentSectionIds[0])
        return
      }

      if (isAtBottom && currentSectionIds.length > 0) {
        setActiveSection(currentSectionIds[currentSectionIds.length - 1])
        return
      }

      // Find section whose position is closest to middle of viewport
      // This creates smoother transitions as we scroll
      let closestSection = null
      let closestDistance = Number.POSITIVE_INFINITY

      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (!ref || !currentSectionIds.includes(id)) return

        const rect = ref.getBoundingClientRect()
        const sectionTop =
          rect.top + scrollTop - (contentRef.current?.getBoundingClientRect().top || 0)
        const sectionMiddle = sectionTop + rect.height / 2
        const distance = Math.abs(viewportMiddle - sectionMiddle)

        if (distance < closestDistance) {
          closestDistance = distance
          closestSection = id
        }
      })

      if (closestSection) {
        setActiveSection(closestSection)
      }
    }

    // Use a passive scroll listener for smooth transitions
    const handleScroll = () => {
      // Using requestAnimationFrame ensures we only calculate
      // section positions during a paint frame, reducing jank
      window.requestAnimationFrame(determineActiveSection)
    }

    const contentElement = contentRef.current
    contentElement?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      contentElement?.removeEventListener('scroll', handleScroll)
    }
  }, [initialFetchCompleted.current, loading, filteredWorkflows, loadedSections])

  // Function to handle template selection
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    setViewMode('detail')
  }

  // Function to go back to list view
  const handleBackToList = () => {
    setSelectedTemplateId(null)
    setViewMode('list')
  }

  // If in detail mode, show the template detail component
  if (viewMode === 'detail' && selectedTemplateId) {
    return <TemplateDetailPage templateId={selectedTemplateId} onBack={handleBackToList} />
  }

  return (
    <div className={`flex h-[100vh] flex-col transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}>
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
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
              {Array.from({ length: 6 }).map((_, index) => (
                <WorkflowCardSkeleton key={`skeleton-${index}`} />
              ))}
            </div>
          </Section>
        )}

        {/* Render template sections */}
        {!loading && (
          <>
            {sortedFilteredWorkflows.map(
              ([category, workflows]) =>
                workflows.length > 0 && (
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
                    <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
                      {workflows.map((workflow, index) => (
                        <TemplateWorkflowCard
                          key={workflow.id}
                          workflow={workflow}
                          index={index}
                          onHover={ensureWorkflowState}
                          onSelect={handleTemplateSelect}
                        />
                      ))}
                    </div>
                  </Section>
                )
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
