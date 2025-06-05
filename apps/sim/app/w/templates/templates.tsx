'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'
import { useSidebarStore } from '@/stores/sidebar/store'
import { TemplatesHeader } from './components/control-bar/control-bar'
import { ErrorMessage } from './components/error-message'
import { Section } from './components/section'
import { TemplateGrid } from './components/shared/template-grid'
import { CATEGORIES, getCategoryLabel } from './constants/categories'
import {
  getTemplateDescription,
  type TemplateCollection,
  type TemplateData,
  type Workflow,
} from './types'

const logger = createLogger('Templates')

export type TemplateWorkflow = TemplateData

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

  const [stateLoadedTemplates, setStateLoadedTemplates] = useState<Set<string>>(new Set())
  const [isLoadingStates, setIsLoadingStates] = useState<Set<string>>(new Set())

  const { mode, isExpanded } = useSidebarStore()

  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)
  const initialFetchCompleted = useRef(false)

  const observerRef = useRef<IntersectionObserver | null>(null)

  const loadTemplateState = async (templateId: string) => {
    if (stateLoadedTemplates.has(templateId) || isLoadingStates.has(templateId)) {
      return
    }

    setIsLoadingStates((prev) => new Set(prev).add(templateId))

    try {
      const response = await fetch(
        `/api/templates/workflows?templateId=${templateId}&includeState=true`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch template state')
      }

      const stateData = await response.json()

      if (stateData.workflowState) {
        setTemplateData((prev) => {
          const updated = { ...prev }

          updated.popular = updated.popular.map((template) =>
            template.id === templateId
              ? { ...template, workflowState: stateData.workflowState }
              : template
          )

          Object.keys(updated.byCategory).forEach((category) => {
            updated.byCategory[category] = updated.byCategory[category].map((template) =>
              template.id === templateId
                ? { ...template, workflowState: stateData.workflowState }
                : template
            )
          })

          return updated
        })

        setStateLoadedTemplates((prev) => new Set(prev).add(templateId))
      }
    } catch (error) {
      logger.warn(`Failed to load state for template ${templateId}:`, error)
    } finally {
      setIsLoadingStates((prev) => {
        const newSet = new Set(prev)
        newSet.delete(templateId)
        return newSet
      })
    }
  }

  const registerTemplateCard = (element: HTMLElement, templateId: string) => {
    if (observerRef.current) {
      observerRef.current.observe(element)
    }
  }

  const workflowData = useMemo(() => {
    const convertTemplateItems = (items: TemplateData[]) =>
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
        // Add loading state indicator
        isStateLoading: isLoadingStates.has(item.id),
      }))

    const result: Record<string, Workflow[]> = {
      popular: convertTemplateItems(templateData.popular),
    }

    Object.entries(templateData.byCategory).forEach(([category, items]) => {
      result[category] = convertTemplateItems(items || [])
    })

    return result
  }, [templateData, isLoadingStates])

  const filteredWorkflows = useMemo(() => {
    let dataToFilter = workflowData

    if (categoryFilter && categoryFilter.length > 0) {
      const filtered: Record<string, Workflow[]> = {}

      if (dataToFilter.popular) filtered.popular = dataToFilter.popular

      categoryFilter.forEach((category) => {
        if (dataToFilter[category]) {
          filtered[category] = dataToFilter[category]
        }
      })

      dataToFilter = filtered
    }

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

  const sortedFilteredWorkflows = useMemo(() => {
    const entries = Object.entries(filteredWorkflows)

    entries.sort((a, b) => {
      const indexA = SECTION_ORDER.indexOf(a[0])
      const indexB = SECTION_ORDER.indexOf(b[0])

      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB
      }

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

        // PHASE 1: Load popular templates WITH state (immediate previews for most viewed)
        const popularPromise = fetch(
          '/api/templates/workflows?section=popular&popularLimit=9&includeState=true'
        )

        // PHASE 2: Load category templates WITHOUT state (ultra-fast structural load)
        const categoriesPromise = fetch(
          '/api/templates/workflows?section=byCategory&limit=6&includeState=false'
        )

        const [popularResponse, categoriesResponse] = await Promise.all([
          popularPromise,
          categoriesPromise,
        ])

        if (!popularResponse.ok || !categoriesResponse.ok) {
          throw new Error('Failed to fetch template data')
        }

        const [popularData, categoriesData] = await Promise.all([
          popularResponse.json(),
          categoriesResponse.json(),
        ])

        // Combine the data
        const combinedData = {
          popular: popularData.popular || [],
          byCategory: categoriesData.byCategory || {},
        }

        const allSections = new Set(['popular', ...CATEGORIES.map((cat) => cat.value)])
        setLoadedSections(allSections)

        setTemplateData(combinedData)
        initialFetchCompleted.current = true

        setActiveSection('popular')
        setLoading(false)

        logger.info(
          'Templates loaded - Popular with state, categories without state for lazy loading'
        )
      } catch (error) {
        logger.error('Error fetching templates:', error)
        setError('Failed to load templates. Please try again later.')
        setLoading(false)
      }
    }

    fetchInitialData()
  }, [])

  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  useEffect(() => {
    if (!initialFetchCompleted.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const intersectingEntry = entries.find((entry) => entry.isIntersecting)
        if (intersectingEntry) {
          setActiveSection(intersectingEntry.target.id)
        }
      },
      {
        root: contentRef.current,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0.1,
      }
    )

    Object.entries(sectionRefs.current).forEach(([id, ref]) => {
      if (ref) {
        observer.observe(ref)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [initialFetchCompleted.current])

  // Intersection observer for lazy loading template states
  useEffect(() => {
    if (!initialFetchCompleted.current) return

    const lazyLoadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const templateId = entry.target.getAttribute('data-template-id')
            const hasState = entry.target.getAttribute('data-has-state') === 'true'
            const isLoading = entry.target.getAttribute('data-is-loading') === 'true'

            if (templateId && !hasState && !isLoading && !stateLoadedTemplates.has(templateId)) {
              loadTemplateState(templateId)
            }
          }
        })
      },
      {
        root: contentRef.current,
        rootMargin: '200px',
        threshold: 0.1,
      }
    )

    observerRef.current = lazyLoadObserver

    return () => {
      lazyLoadObserver.disconnect()
      observerRef.current = null
    }
  }, [initialFetchCompleted.current, stateLoadedTemplates])

  return (
    <div
      className={`flex h-[100vh] w-full max-w-[100vw] flex-col overflow-x-hidden transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
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
            <TemplateGrid isLoading={true} skeletonCount={6} workflows={[]} />
          </Section>
        )}

        {/* Render template sections */}
        {!loading && (
          <>
            {sortedFilteredWorkflows.map(([category, workflows]) => {
              // Determine if we should show Browse All button
              // Popular should never show Browse All
              // Other categories should show Browse All with their specific category name
              const showBrowseAll = category !== 'popular' && !searchQuery.trim()

              // Show sections if they have workflows OR if no search is active (to allow empty sections to trigger loading)
              const shouldShowSection = workflows.length > 0 || !searchQuery.trim()

              return (
                shouldShowSection && (
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
                      onRegisterCard={registerTemplateCard}
                    />
                  </Section>
                )
              )
            })}

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
