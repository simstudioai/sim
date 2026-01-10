'use client'

import { useMemo, useState } from 'react'
import { Layout, Search } from 'lucide-react'
import { Button } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import type { CreatorProfileDetails } from '@/app/_types/creator-profile'
import {
  TemplateCard,
  TemplateCardSkeleton,
} from '@/app/workspace/[workspaceId]/templates/components/template-card'
import { useDebounce } from '@/hooks/use-debounce'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Template data structure
 */
export interface Template {
  /** Unique identifier for the template */
  id: string
  /** Associated workflow ID if linked to a workflow */
  workflowId: string | null
  /** Display name of the template */
  name: string
  /** Additional template details */
  details?: {
    tagline?: string
    about?: string
  } | null
  /** ID of the template creator profile */
  creatorId: string | null
  /** Creator profile information */
  creator?: {
    id: string
    name: string
    profileImageUrl?: string | null
    details?: CreatorProfileDetails | null
    referenceType: 'user' | 'organization'
    referenceId: string
    verified?: boolean
  } | null
  /** Number of views */
  views: number
  /** Number of stars */
  stars: number
  /** Approval status */
  status: 'pending' | 'approved' | 'rejected'
  /** Categorization tags */
  tags: string[]
  /** Required credential types */
  requiredCredentials: unknown
  /** Workflow state data */
  state: WorkflowState
  /** Creation timestamp */
  createdAt: Date | string
  /** Last update timestamp */
  updatedAt: Date | string
  /** Whether the current user has starred this template */
  isStarred: boolean
  /** Whether the current user is a super user */
  isSuperUser?: boolean
  /** Display color for the template card */
  color?: string
  /** Display icon for the template card */
  icon?: string
}

/**
 * Props for the Templates component
 */
interface TemplatesProps {
  /** Initial list of templates to display */
  initialTemplates: Template[]
  /** Current authenticated user ID */
  currentUserId: string
  /** Whether current user has super user privileges */
  isSuperUser: boolean
}

/**
 * Templates list component displaying workflow templates
 * Supports filtering by tab (gallery/your/pending) and search
 *
 * @param props - Component props
 * @returns Templates page component
 */
export default function Templates({
  initialTemplates,
  currentUserId,
  isSuperUser,
}: TemplatesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [activeTab, setActiveTab] = useState('gallery')
  const [templates] = useState<Template[]>(initialTemplates)
  const [loading] = useState(false)

  /**
   * Filter templates based on active tab and search query
   */
  const filteredTemplates = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase()

    return templates.filter((template) => {
      const tabMatch =
        activeTab === 'your'
          ? template.creator?.referenceId === currentUserId || template.isStarred
          : activeTab === 'gallery'
            ? template.status === 'approved'
            : template.status === 'pending'

      if (!tabMatch) return false

      if (!query) return true

      const searchableText = [template.name, template.details?.tagline, template.creator?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }, [templates, activeTab, debouncedSearchQuery, currentUserId])

  /**
   * Get empty state message based on current filters
   */
  const emptyState = useMemo(() => {
    if (debouncedSearchQuery) {
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
  }, [debouncedSearchQuery, activeTab])

  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#5BA8D9] bg-[#E8F4FB] dark:border-[#1A5070] dark:bg-[#153347]'>
                <Layout className='h-[14px] w-[14px] text-[#5BA8D9] dark:text-[#33b4ff]' />
              </div>
              <h1 className='font-medium text-[18px]'>Templates</h1>
            </div>
            <p className='mt-[10px] text-[14px] text-[var(--text-tertiary)]'>
              Grab a template and start building, or make one from scratch.
            </p>
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
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

          <div className='mt-[24px] grid grid-cols-1 gap-x-[20px] gap-y-[40px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            {loading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TemplateCardSkeleton key={`skeleton-${index}`} />
              ))
            ) : filteredTemplates.length === 0 ? (
              <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-muted-foreground text-sm'>{emptyState.title}</p>
                  <p className='mt-1 text-muted-foreground/70 text-xs'>{emptyState.description}</p>
                </div>
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  id={template.id}
                  title={template.name}
                  author={template.creator?.name || 'Unknown'}
                  authorImageUrl={template.creator?.profileImageUrl || null}
                  usageCount={template.views.toString()}
                  stars={template.stars}
                  state={template.state}
                  isStarred={template.isStarred}
                  isVerified={template.creator?.verified || false}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
