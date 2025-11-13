'use client'

import { useMemo, useState } from 'react'
import { Layout, Search } from 'lucide-react'
import { Button } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console/logger'
import {
  TemplateCard,
  TemplateCardSkeleton,
} from '@/app/workspace/[workspaceId]/templates/components/template-card'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { CreatorProfileDetails } from '@/types/creator-profile'

const logger = createLogger('TemplatesPage')

/**
 * Template data structure with support for both new and legacy fields
 */
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
  requiredCredentials: unknown
  state: WorkflowState
  createdAt: Date | string
  updatedAt: Date | string
  isStarred: boolean
  isSuperUser?: boolean
  // Legacy fields for backward compatibility with existing UI
  userId?: string
  description?: string | null
  author?: string
  authorType?: 'user' | 'organization'
  organizationId?: string | null
  color?: string
  icon?: string
}

interface TemplatesProps {
  initialTemplates: Template[]
  currentUserId: string
  isSuperUser: boolean
}

/**
 * Templates list component displaying workflow templates
 * Supports filtering by tab (gallery/your/pending) and search
 */
export default function Templates({
  initialTemplates,
  currentUserId,
  isSuperUser,
}: TemplatesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('gallery')
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [loading, setLoading] = useState(false)

  /**
   * Update star status for a template
   */
  const handleStarChange = (templateId: string, isStarred: boolean, newStarCount: number) => {
    setTemplates((prevTemplates) =>
      prevTemplates.map((template) =>
        template.id === templateId ? { ...template, isStarred, stars: newStarCount } : template
      )
    )
  }

  /**
   * Filter templates based on active tab and search query
   * Memoized to prevent unnecessary recalculations on render
   */
  const filteredTemplates = useMemo(() => {
    const query = searchQuery.toLowerCase()

    return templates.filter((template) => {
      // Filter by tab
      const tabMatch =
        activeTab === 'your'
          ? template.userId === currentUserId || template.isStarred
          : activeTab === 'gallery'
            ? template.status === 'approved'
            : template.status === 'pending'

      if (!tabMatch) return false

      // Filter by search query
      if (!query) return true

      const searchableText = [
        template.name,
        template.description,
        template.details?.tagline,
        template.author,
        template.creator?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }, [templates, activeTab, searchQuery, currentUserId])

  /**
   * Get empty state message based on current filters
   * Memoized to prevent unnecessary recalculations on render
   */
  const emptyState = useMemo(() => {
    if (searchQuery) {
      return {
        title: 'No templates found',
        description: 'Try a different search term',
      }
    }

    const messages = {
      pending: {
        title: 'No pending templates',
        description: 'New submissions will appear here',
      },
      your: {
        title: 'No templates yet',
        description: 'Create or star templates to see them here',
      },
      gallery: {
        title: 'No templates available',
        description: 'Templates will appear once approved',
      },
    }

    return messages[activeTab as keyof typeof messages] || messages.gallery
  }, [searchQuery, activeTab])

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#7A5F11] bg-[#514215]'>
                <Layout className='h-[14px] w-[14px] text-[#FBBC04]' />
              </div>
              <h1 className='font-medium text-[18px]'>Templates</h1>
            </div>
            <p className='mt-[10px] font-base text-[#888888] text-[14px]'>
              Grab a template and start building, or make one from scratch.
            </p>
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-5)] px-[8px]'>
              <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
              <Input
                placeholder='Search'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
            <div className='flex items-center gap-[8px]'>
              <Button
                variant={activeTab === 'gallery' ? 'active' : 'default'}
                className='h-[32px] rounded-[6px]'
                onClick={() => setActiveTab('gallery')}
              >
                Gallery
              </Button>
              <Button
                variant={activeTab === 'your' ? 'active' : 'default'}
                className='h-[32px] rounded-[6px]'
                onClick={() => setActiveTab('your')}
              >
                Your Templates
              </Button>
              {isSuperUser && (
                <Button
                  variant={activeTab === 'pending' ? 'active' : 'default'}
                  className='h-[32px] rounded-[6px]'
                  onClick={() => setActiveTab('pending')}
                >
                  Pending
                </Button>
              )}
            </div>
          </div>

          <div className='mt-[24px] h-[1px] w-full border-[var(--border)] border-t' />

          <div className='mt-[24px] grid grid-cols-1 gap-x-[20px] gap-y-[40px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {loading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TemplateCardSkeleton key={`skeleton-${index}`} />
              ))
            ) : filteredTemplates.length === 0 ? (
              <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 border-dashed bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-muted-foreground text-sm'>{emptyState.title}</p>
                  <p className='mt-1 text-muted-foreground/70 text-xs'>{emptyState.description}</p>
                </div>
              </div>
            ) : (
              filteredTemplates.map((template) => {
                const author = template.author || template.creator?.name || 'Unknown'
                const authorImageUrl = template.creator?.profileImageUrl || null

                return (
                  <TemplateCard
                    key={template.id}
                    id={template.id}
                    title={template.name}
                    description={template.description || template.details?.tagline || ''}
                    author={author}
                    authorImageUrl={authorImageUrl}
                    usageCount={template.views.toString()}
                    stars={template.stars}
                    icon={template.icon}
                    iconColor={template.color}
                    state={template.state}
                    isStarred={template.isStarred}
                    onStarChange={handleStarChange}
                    isAuthenticated={true}
                  />
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
