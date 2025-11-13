'use client'

import { useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console/logger'
import type { CredentialRequirement } from '@/lib/workflows/credential-extractor'
import { NavigationTabs } from '@/app/templates/components/navigation-tabs'
import { TemplateCard, TemplateCardSkeleton } from '@/app/templates/components/template-card'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { CreatorProfileDetails } from '@/types/creator-profile'

const logger = createLogger('TemplatesPage')

export interface Template {
  id: string
  workflowId: string | null
  name: string
  details?: {
    tagline?: string
    about?: string
  } | null
  creatorId: string | null
  creator?: {
    id: string
    name: string
    profileImageUrl?: string | null
    details?: CreatorProfileDetails | null
    referenceType: 'user' | 'organization'
    referenceId: string
  } | null
  views: number
  stars: number
  status: 'pending' | 'approved' | 'rejected'
  tags: string[]
  requiredCredentials: CredentialRequirement[]
  state: WorkflowState
  createdAt: Date | string
  updatedAt: Date | string
  isStarred: boolean
  isSuperUser?: boolean
}

interface TemplatesProps {
  initialTemplates: Template[]
  currentUserId: string | null
  isSuperUser: boolean
}

export default function Templates({
  initialTemplates,
  currentUserId,
  isSuperUser,
}: TemplatesProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('gallery')
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

  const matchesSearch = (template: Template) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      template.name.toLowerCase().includes(query) ||
      template.details?.tagline?.toLowerCase().includes(query) ||
      template.creator?.name?.toLowerCase().includes(query)
    )
  }

  const ownedTemplates = currentUserId
    ? templates.filter(
        (template) =>
          template.creator?.referenceType === 'user' &&
          template.creator?.referenceId === currentUserId
      )
    : []
  const starredTemplates = currentUserId
    ? templates.filter(
        (template) =>
          template.isStarred &&
          !(
            template.creator?.referenceType === 'user' &&
            template.creator?.referenceId === currentUserId
          )
      )
    : []

  const filteredOwnedTemplates = ownedTemplates.filter(matchesSearch)
  const filteredStarredTemplates = starredTemplates.filter(matchesSearch)

  const galleryTemplates = templates
    .filter((template) => template.status === 'approved')
    .filter(matchesSearch)

  const pendingTemplates = templates
    .filter((template) => template.status === 'pending')
    .filter(matchesSearch)

  // Helper function to render template cards
  const renderTemplateCard = (template: Template) => (
    <TemplateCard
      key={template.id}
      id={template.id}
      title={template.name}
      description={template.details?.tagline || ''}
      author={template.creator?.name || 'Unknown'}
      authorImageUrl={template.creator?.profileImageUrl || null}
      usageCount={template.views.toString()}
      stars={template.stars}
      tags={template.tags}
      state={template.state as { blocks?: Record<string, { type: string; name?: string }> }}
      isStarred={template.isStarred}
      onStarChange={handleStarChange}
      isAuthenticated={!!currentUserId}
    />
  )

  // Render skeleton cards for loading state
  const renderSkeletonCards = () => {
    return Array.from({ length: 8 }).map((_, index) => (
      <TemplateCardSkeleton key={`skeleton-${index}`} />
    ))
  }

  // Calculate counts for tabs
  const yourTemplatesCount = ownedTemplates.length + starredTemplates.length
  const galleryCount = templates.filter((template) => template.status === 'approved').length
  const pendingCount = templates.filter((template) => template.status === 'pending').length

  // Build tabs based on user status
  const navigationTabs = [
    {
      id: 'gallery',
      label: 'Gallery',
      count: galleryCount,
    },
    ...(currentUserId
      ? [
          {
            id: 'your',
            label: 'Your Templates',
            count: yourTemplatesCount,
          },
        ]
      : []),
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

  // Show tabs if there's more than one tab
  const showTabs = navigationTabs.length > 1

  const handleBackToWorkspace = async () => {
    try {
      const response = await fetch('/api/workspaces')
      if (response.ok) {
        const data = await response.json()
        const defaultWorkspace = data.workspaces?.[0]
        if (defaultWorkspace) {
          router.push(`/workspace/${defaultWorkspace.id}`)
        }
      }
    } catch (error) {
      logger.error('Error navigating to workspace:', error)
    }
  }

  return (
    <div className='flex h-[100vh] flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto p-6'>
          {/* Header with Back Button */}
          <div className='mb-6'>
            {currentUserId && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleBackToWorkspace}
                className='-ml-2 mb-4 text-muted-foreground hover:text-foreground'
              >
                <ArrowLeft className='mr-2 h-4 w-4' />
                Back to Workspace
              </Button>
            )}
            <h1 className='mb-2 font-sans font-semibold text-3xl text-foreground tracking-[0.01em]'>
              Templates
            </h1>
            <p className='font-[350] font-sans text-muted-foreground text-sm leading-[1.5] tracking-[0.01em]'>
              Grab a template and start building, or make
              <br />
              one from scratch.
            </p>
          </div>

          {/* Search */}
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
          </div>

          {/* Navigation - only show if multiple tabs */}
          {showTabs && (
            <div className='mb-6'>
              <NavigationTabs
                tabs={navigationTabs}
                activeTab={activeTab}
                onTabClick={handleTabClick}
              />
            </div>
          )}

          {loading ? (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {renderSkeletonCards()}
            </div>
          ) : activeTab === 'your' ? (
            filteredOwnedTemplates.length === 0 && filteredStarredTemplates.length === 0 ? (
              <div className='flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 border-dashed bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-muted-foreground text-sm'>
                    {searchQuery ? 'No templates found' : 'No templates yet'}
                  </p>
                  <p className='mt-1 text-muted-foreground/70 text-xs'>
                    {searchQuery
                      ? 'Try a different search term'
                      : 'Create or star templates to see them here'}
                  </p>
                </div>
              </div>
            ) : (
              <div className='space-y-8'>
                {filteredOwnedTemplates.length > 0 && (
                  <section>
                    <h2 className='mb-3 font-semibold text-lg'>Your Templates</h2>
                    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                      {filteredOwnedTemplates.map((template) => renderTemplateCard(template))}
                    </div>
                  </section>
                )}

                {filteredStarredTemplates.length > 0 && (
                  <section>
                    <h2 className='mb-3 font-semibold text-lg'>Starred Templates</h2>
                    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                      {filteredStarredTemplates.map((template) => renderTemplateCard(template))}
                    </div>
                  </section>
                )}
              </div>
            )
          ) : (
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {(activeTab === 'gallery' ? galleryTemplates : pendingTemplates).length === 0 ? (
                <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 border-dashed bg-muted/20'>
                  <div className='text-center'>
                    <p className='font-medium text-muted-foreground text-sm'>
                      {searchQuery
                        ? 'No templates found'
                        : activeTab === 'pending'
                          ? 'No pending templates'
                          : 'No templates available'}
                    </p>
                    <p className='mt-1 text-muted-foreground/70 text-xs'>
                      {searchQuery
                        ? 'Try a different search term'
                        : activeTab === 'pending'
                          ? 'New submissions will appear here'
                          : 'Templates will appear once approved'}
                    </p>
                  </div>
                </div>
              ) : (
                (activeTab === 'gallery' ? galleryTemplates : pendingTemplates).map((template) =>
                  renderTemplateCard(template)
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
