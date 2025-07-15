'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console-logger'
import { NavigationTabs } from './components/navigation-tabs'
import { TemplateCard, TemplateCardSkeleton } from './components/template-card'

const logger = createLogger('TemplatesPage')

// Shared categories definition
export const categories = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'support', label: 'Support' },
  { value: 'artificial-intelligence', label: 'Artificial Intelligence' },
  { value: 'other', label: 'Other' },
] as const

export type CategoryValue = (typeof categories)[number]['value']

// Template data structure
interface Template {
  id: string
  workflowId: string
  name: string
  description: string
  author: string
  views: number
  stars: number
  color: string
  icon: string
  category: CategoryValue
  state: {
    blocks?: Record<string, { type: string; name?: string }>
    edges?: any[]
    loops?: Record<string, any>
    parallels?: Record<string, any>
  }
  createdAt: string
  updatedAt: string
  isStarred?: boolean
}

export default function Templates() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('your')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  // Refs for scrolling to sections
  const sectionRefs = {
    your: useRef<HTMLDivElement>(null),
    marketing: useRef<HTMLDivElement>(null),
    sales: useRef<HTMLDivElement>(null),
    finance: useRef<HTMLDivElement>(null),
    support: useRef<HTMLDivElement>(null),
    'artificial-intelligence': useRef<HTMLDivElement>(null),
    other: useRef<HTMLDivElement>(null),
  }

  // Fetch templates from API
  const fetchTemplates = async () => {
    try {
      setLoading(true)

      const response = await fetch('/api/templates')
      if (!response.ok) {
        throw new Error('Failed to fetch templates')
      }

      const data = await response.json()
      setTemplates(data.data || [])
    } catch (error) {
      logger.error('Error fetching templates:', error)
      // Just set empty array on error instead of showing error state
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }

  // Load templates on component mount
  useEffect(() => {
    fetchTemplates()
  }, [])

  // Get starred templates count for determining if "Your templates" should be shown
  const starredTemplatesCount = templates.filter((template) => template.isStarred === true).length

  // Handle case where active tab is "your" but user has no starred templates
  useEffect(() => {
    if (!loading && activeTab === 'your' && starredTemplatesCount === 0) {
      setActiveTab('marketing') // Switch to first available tab
    }
  }, [loading, activeTab, starredTemplatesCount])

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    const sectionRef = sectionRefs[tabId as keyof typeof sectionRefs]
    if (sectionRef.current) {
      sectionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  const handleTemplateClick = (templateId: string) => {
    // TODO: Navigate to template detail page
    console.log('Template clicked:', templateId)
  }

  const handleCreateNew = () => {
    // TODO: Open create template modal or navigate to create page
    console.log('Create new template')
  }

  const filteredTemplates = (category: CategoryValue | 'your') => {
    let filteredByCategory = templates

    if (category === 'your') {
      // For "your" templates, show only starred templates
      filteredByCategory = templates.filter((template) => template.isStarred === true)
    } else {
      filteredByCategory = templates.filter((template) => template.category === category)
    }

    if (!searchQuery) return filteredByCategory

    return filteredByCategory.filter(
      (template) =>
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.author.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }

  // Group templates by category for display
  const getTemplatesByCategory = (category: CategoryValue | 'your') => {
    return filteredTemplates(category)
  }

  // Render skeleton cards for loading state
  const renderSkeletonCards = () => {
    return Array.from({ length: 8 }).map((_, index) => (
      <TemplateCardSkeleton key={`skeleton-${index}`} />
    ))
  }

  // Calculate navigation tabs with real counts or skeleton counts
  const navigationTabs = [
    // Only include "Your templates" tab if user has starred templates
    ...(starredTemplatesCount > 0 || loading
      ? [
          {
            id: 'your',
            label: 'Your templates',
            count: loading ? 8 : getTemplatesByCategory('your').length,
          },
        ]
      : []),
    {
      id: 'marketing',
      label: 'Marketing',
      count: loading ? 8 : getTemplatesByCategory('marketing').length,
    },
    { id: 'sales', label: 'Sales', count: loading ? 8 : getTemplatesByCategory('sales').length },
    {
      id: 'finance',
      label: 'Finance',
      count: loading ? 8 : getTemplatesByCategory('finance').length,
    },
    {
      id: 'support',
      label: 'Support',
      count: loading ? 8 : getTemplatesByCategory('support').length,
    },
    {
      id: 'artificial-intelligence',
      label: 'Artificial Intelligence',
      count: loading ? 8 : getTemplatesByCategory('artificial-intelligence').length,
    },
    { id: 'other', label: 'Other', count: loading ? 8 : getTemplatesByCategory('other').length },
  ]

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto p-6'>
          {/* Header */}
          <div className='mb-6'>
            <h1 className='mb-2 font-sans font-semibold text-3xl text-foreground tracking-[0.01em]'>
              Templates
            </h1>
            <p className='font-[350] font-sans text-muted-foreground text-sm leading-[1.5] tracking-[0.01em]'>
              Grab a template and start building, or make
              <br />
              one from scratch.
            </p>
          </div>

          {/* Search and Create New */}
          <div className='mb-6 flex items-center justify-between'>
            <div className='flex h-9 w-[460px] items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
              <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
              <Input
                placeholder='Search templates...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='flex-1 border-0 bg-transparent px-0 font-normal font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
            {/* <Button
              onClick={handleCreateNew}
              className='flex h-9 items-center gap-2 rounded-lg bg-[#701FFC] px-4 py-2 font-normal font-sans text-sm text-white hover:bg-[#601EE0]'
            >
              <Plus className='h-4 w-4' />
              Create New
            </Button> */}
          </div>

          {/* Navigation */}
          <div className='mb-6'>
            <NavigationTabs
              tabs={navigationTabs}
              activeTab={activeTab}
              onTabClick={handleTabClick}
            />
          </div>

          {/* Your Templates Section */}
          {starredTemplatesCount > 0 || loading ? (
            <div ref={sectionRefs.your} className='mb-8'>
              <div className='mb-4 flex items-center gap-2'>
                <h2 className='font-medium font-sans text-foreground text-lg'>Your templates</h2>
                <ChevronRight className='h-4 w-4 text-muted-foreground' />
              </div>

              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                {loading
                  ? renderSkeletonCards()
                  : getTemplatesByCategory('your').map((template) => (
                      <TemplateCard
                        key={template.id}
                        id={template.id}
                        title={template.name}
                        description={template.description}
                        author={template.author}
                        usageCount={template.views.toString()}
                        state={template.state}
                        onClick={() => handleTemplateClick(template.id)}
                      />
                    ))}
              </div>
            </div>
          ) : null}

          {/* Marketing Section */}
          <div ref={sectionRefs.marketing} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>Marketing</h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('marketing').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>

          {/* Sales Section */}
          <div ref={sectionRefs.sales} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>Sales</h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('sales').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>

          {/* Finance Section */}
          <div ref={sectionRefs.finance} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>Finance</h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('finance').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>

          {/* Support Section */}
          <div ref={sectionRefs.support} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>Support</h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('support').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>

          {/* Artificial Intelligence Section */}
          <div ref={sectionRefs['artificial-intelligence']} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>
                Artificial Intelligence
              </h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('artificial-intelligence').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>

          {/* Other Section */}
          <div ref={sectionRefs.other} className='mb-8'>
            <div className='mb-4 flex items-center gap-2'>
              <h2 className='font-medium font-sans text-foreground text-lg'>Other</h2>
              <ChevronRight className='h-4 w-4 text-muted-foreground' />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {loading
                ? renderSkeletonCards()
                : getTemplatesByCategory('other').map((template) => (
                    <TemplateCard
                      key={template.id}
                      id={template.id}
                      title={template.name}
                      description={template.description}
                      author={template.author}
                      usageCount={template.views.toString()}
                      state={template.state}
                      onClick={() => handleTemplateClick(template.id)}
                    />
                  ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
