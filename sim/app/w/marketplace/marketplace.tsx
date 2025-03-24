'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorMessage } from './components/error-message'
import { Section } from './components/section'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkflowCard } from './components/workflow-card'
import { WorkflowCardSkeleton } from './components/workflow-card-skeleton'

// Types
export interface Workflow {
  id: string
  name: string
  description: string
  author: string
  stars: number
  views: number
  tags: string[]
  thumbnail?: string
  workflowUrl?: string
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
export interface MarketplaceWorkflow {
  id: string
  workflowId: string
  name: string
  description: string
  authorName: string
  stars: number
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

export interface MarketplaceData {
  popular: MarketplaceWorkflow[]
  recent: MarketplaceWorkflow[]
  byCategory: Record<string, MarketplaceWorkflow[]>
}

export default function Marketplace() {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marketplaceData, setMarketplaceData] = useState<MarketplaceData>({
    popular: [],
    recent: [],
    byCategory: {},
  })
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Create refs for each section
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)

  // Convert marketplace data to the format expected by components
  const workflowData = useMemo(() => {
    const result: Record<string, Workflow[]> = {
      popular: marketplaceData.popular.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: item.authorName,
        stars: item.stars,
        views: item.views,
        tags: [item.category],
        workflowState: item.workflowState,
      })),
      recent: marketplaceData.recent.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        author: item.authorName,
        stars: item.stars,
        views: item.views,
        tags: [item.category],
        workflowState: item.workflowState,
      })),
    }

    // Add entries for each category
    Object.entries(marketplaceData.byCategory).forEach(([category, items]) => {
      if (items && items.length > 0) {
        result[category] = items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || '',
          author: item.authorName,
          stars: item.stars,
          views: item.views,
          tags: [item.category],
          workflowState: item.workflowState,
        }))
      }
    })

    return result
  }, [marketplaceData])

  // Fetch workflows on component mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        setLoading(true)

        const response = await fetch('/api/marketplace/featured')

        if (!response.ok) {
          throw new Error('Failed to fetch marketplace data')
        }

        const data = await response.json()
        setMarketplaceData(data)

        // Set initial active section to first category
        setActiveSection('popular')
        setLoading(false)
      } catch (error) {
        console.error('Error fetching workflows:', error)
        setError('Failed to load workflows. Please try again later.')
        setLoading(false)
      }
    }

    fetchWorkflows()
  }, [])

  // Function to fetch workflow state for a specific workflow
  const fetchWorkflowState = async (workflowId: string) => {
    try {
      // Find which section contains this workflow
      let foundWorkflow: MarketplaceWorkflow | undefined

      // Check in popular section
      foundWorkflow = marketplaceData.popular.find((w) => w.id === workflowId)

      // Check in recent section if not found
      if (!foundWorkflow) {
        foundWorkflow = marketplaceData.recent.find((w) => w.id === workflowId)
      }

      // Check in category sections if not found
      if (!foundWorkflow) {
        for (const category of Object.keys(marketplaceData.byCategory)) {
          foundWorkflow = marketplaceData.byCategory[category].find((w) => w.id === workflowId)
          if (foundWorkflow) break
        }
      }

      // If we have the workflow and it doesn't already have state
      if (foundWorkflow && !foundWorkflow.workflowState) {
        // In a real implementation, fetch the workflow state from the server
        // For now, we'll just use a placeholder
        const response = await fetch(`/api/marketplace/${foundWorkflow.workflowId}/state`, {
          method: 'GET',
        })

        if (response.ok) {
          const stateData = await response.json()

          // Update the workflow data with the state
          setMarketplaceData((prevData) => {
            const updatedData = { ...prevData }

            // Update in popular
            updatedData.popular = updatedData.popular.map((w) =>
              w.id === workflowId ? { ...w, workflowState: stateData.state } : w
            )

            // Update in recent
            updatedData.recent = updatedData.recent.map((w) =>
              w.id === workflowId ? { ...w, workflowState: stateData.state } : w
            )

            // Update in categories
            Object.keys(updatedData.byCategory).forEach((category) => {
              updatedData.byCategory[category] = updatedData.byCategory[category].map((w) =>
                w.id === workflowId ? { ...w, workflowState: stateData.state } : w
              )
            })

            return updatedData
          })
        }
      }
    } catch (error) {
      console.error(`Error fetching workflow state for ${workflowId}:`, error)
    }
  }

  // Filter workflows based on search query
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) {
      return workflowData
    }

    const query = searchQuery.toLowerCase()
    const filtered: Record<string, Workflow[]> = {}

    Object.entries(workflowData).forEach(([category, workflows]) => {
      const matchingWorkflows = workflows.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(query) ||
          workflow.description.toLowerCase().includes(query) ||
          workflow.author.toLowerCase().includes(query) ||
          workflow.tags.some((tag) => tag.toLowerCase().includes(query))
      )

      if (matchingWorkflows.length > 0) {
        filtered[category] = matchingWorkflows
      }
    })

    return filtered
  }, [searchQuery, workflowData])

  // Function to scroll to a specific section
  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  // Setup intersection observer to track active section
  useEffect(() => {
    // Function to get current section IDs in their display order
    const getCurrentSectionIds = () => {
      return Object.keys(filteredWorkflows).filter(
        (key) => filteredWorkflows[key] && filteredWorkflows[key].length > 0
      )
    }

    // Store current section positions for better tracking
    const sectionPositions: Record<string, DOMRect> = {}

    // Initial calculation of section positions
    const calculateSectionPositions = () => {
      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (ref) {
          sectionPositions[id] = ref.getBoundingClientRect()
        }
      })
    }

    // Debounce function to limit rapid position calculations
    const debounce = (fn: Function, delay: number) => {
      let timer: NodeJS.Timeout
      return function (...args: any[]) {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), delay)
      }
    }

    // Calculate positions initially and on resize
    calculateSectionPositions()
    const debouncedCalculatePositions = debounce(calculateSectionPositions, 100)
    window.addEventListener('resize', debouncedCalculatePositions)

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
      let closestDistance = Infinity

      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (!ref || !currentSectionIds.includes(id)) return

        const rect = ref.getBoundingClientRect()
        const sectionTop = rect.top + scrollTop - contentRef.current!.getBoundingClientRect().top
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
      window.removeEventListener('resize', debouncedCalculatePositions)
      contentElement?.removeEventListener('scroll', handleScroll)
    }
  }, [loading, filteredWorkflows])

  return (
    <div className="flex flex-col h-[100vh]">
      {/* Control Bar */}
      <ControlBar setSearchQuery={setSearchQuery} />

      <div className="flex flex-1 overflow-hidden">
        {/* Toolbar */}
        <Toolbar scrollToSection={scrollToSection} activeSection={activeSection} />

        {/* Main content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto py-6 px-6 pb-16">
          {/* Error message */}
          <ErrorMessage message={error} />

          {/* Loading state */}
          {loading && (
            <>
              <Section
                id="loading"
                title="Popular"
                ref={(el) => {
                  sectionRefs.current['loading'] = el
                }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <WorkflowCardSkeleton key={`skeleton-${index}`} />
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* Render workflow sections */}
          {!loading && (
            <>
              {Object.entries(filteredWorkflows).map(
                ([category, workflows]) =>
                  workflows.length > 0 && (
                    <Section
                      key={category}
                      id={category}
                      title={category}
                      ref={(el) => {
                        if (el) {
                          sectionRefs.current[category] = el
                        }
                      }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {workflows.map((workflow, index) => (
                          <WorkflowCard
                            key={workflow.id}
                            workflow={workflow}
                            index={index}
                            onHover={fetchWorkflowState}
                          />
                        ))}
                      </div>
                    </Section>
                  )
              )}

              {Object.keys(filteredWorkflows).length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-64">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No workflows found matching your search.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
