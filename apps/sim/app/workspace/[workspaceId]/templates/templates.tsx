'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console/logger'
import { NavigationTabs } from '@/app/workspace/[workspaceId]/templates/components/navigation-tabs'
import {
  TemplateCard,
  TemplateCardSkeleton,
} from '@/app/workspace/[workspaceId]/templates/components/template-card'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplatesPage')

// Template data structure
export interface Template {
  id: string
  workflowId: string | null
  userId: string
  name: string
  description: string | null
  author: string
  authorType: 'user' | 'organization'
  organizationId: string | null
  views: number
  stars: number
  color: string
  icon: string
  status: 'pending' | 'approved' | 'rejected'
  state: WorkflowState
  createdAt: Date | string
  updatedAt: Date | string
  isStarred: boolean
  isSuperUser?: boolean
}

interface TemplatesProps {
  initialTemplates: Template[]
  currentUserId: string
  isSuperUser: boolean
}

export default function Templates({
  initialTemplates,
  currentUserId,
  isSuperUser,
}: TemplatesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('your')
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [loading, setLoading] = useState(false)

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
  }

  // Handle star change callback from template card
  const handleStarChange = (templateId: string, isStarred: boolean, newStarCount: number) => {
    setTemplates((prevTemplates) =>
      prevTemplates.map((template) =>
        template.id === templateId ? { ...template, isStarred, stars: newStarCount } : template
      )
    )
  }

  // Get templates for the active tab with search filtering
  const getActiveTabTemplates = () => {
    let filtered = templates

    // Filter by active tab
    if (activeTab === 'your') {
      filtered = filtered.filter(
        (template) => template.userId === currentUserId || template.isStarred === true
      )
    } else if (activeTab === 'gallery') {
      // Show all approved templates
      filtered = filtered.filter((template) => template.status === 'approved')
    } else if (activeTab === 'pending') {
      // Show pending templates for super users
      filtered = filtered.filter((template) => template.status === 'pending')
    }

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (template) =>
          template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          template.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          template.author.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return filtered
  }

  const activeTemplates = getActiveTabTemplates()

  // Helper function to render template cards
  const renderTemplateCard = (template: Template) => (
    <TemplateCard
      key={template.id}
      id={template.id}
      title={template.name}
      description={template.description || ''}
      author={template.author}
      usageCount={template.views.toString()}
      stars={template.stars}
      icon={template.icon}
      iconColor={template.color}
      state={template.state as { blocks?: Record<string, { type: string; name?: string }> }}
      isStarred={template.isStarred}
      onStarChange={handleStarChange}
      isAuthenticated={true}
    />
  )

  // Render skeleton cards for loading state
  const renderSkeletonCards = () => {
    return Array.from({ length: 8 }).map((_, index) => (
      <TemplateCardSkeleton key={`skeleton-${index}`} />
    ))
  }

  // Calculate counts for tabs
  const yourTemplatesCount = templates.filter(
    (template) => template.userId === currentUserId || template.isStarred === true
  ).length
  const galleryCount = templates.filter((template) => template.status === 'approved').length
  const pendingCount = templates.filter((template) => template.status === 'pending').length

  const navigationTabs = [
    {
      id: 'gallery',
      label: 'Gallery',
      count: galleryCount,
    },
    {
      id: 'your',
      label: 'Your Templates',
      count: yourTemplatesCount,
    },
    ...(isSuperUser
      ? [
          {
            id: 'pending',
            label: 'Pending',
            count: pendingCount,
          },
        ]
      : []),
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
              className='flex h-9 items-center gap-2 rounded-lg bg-[var(--brand-primary-hex)] px-4 py-2 font-normal font-sans text-sm text-white hover:bg-[#601EE0]'
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

          {/* Templates Grid - Based on Active Tab */}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {loading ? (
              renderSkeletonCards()
            ) : activeTemplates.length === 0 ? (
              <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 border-dashed bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-muted-foreground text-sm'>
                    {searchQuery
                      ? 'No templates found'
                      : activeTab === 'pending'
                        ? 'No pending templates'
                        : activeTab === 'your'
                          ? 'No templates yet'
                          : 'No templates available'}
                  </p>
                  <p className='mt-1 text-muted-foreground/70 text-xs'>
                    {searchQuery
                      ? 'Try a different search term'
                      : activeTab === 'pending'
                        ? 'New submissions will appear here'
                        : activeTab === 'your'
                          ? 'Create or star templates to see them here'
                          : 'Templates will appear once approved'}
                  </p>
                </div>
              </div>
            ) : (
              activeTemplates.map((template) => renderTemplateCard(template))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
