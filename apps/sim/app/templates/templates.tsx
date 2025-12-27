'use client'

import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Layout, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import type { CredentialRequirement } from '@/lib/workflows/credentials/credential-extractor'
import type { CreatorProfileDetails } from '@/app/_types/creator-profile'
import { TemplateCard, TemplateCardSkeleton } from '@/app/templates/components/template-card'
import { useDebounce } from '@/hooks/use-debounce'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
    verified?: boolean
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
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [activeTab, setActiveTab] = useState('gallery')
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (currentUserId) {
      const redirectToWorkspace = async () => {
        try {
          const response = await fetch('/api/workspaces')
          if (response.ok) {
            const data = await response.json()
            const defaultWorkspace = data.workspaces?.[0]
            if (defaultWorkspace) {
              router.push(`/workspace/${defaultWorkspace.id}/templates`)
            }
          }
        } catch (error) {
          logger.error('Error redirecting to workspace:', error)
        }
      }
      redirectToWorkspace()
    }
  }, [currentUserId, router])

  /**
   * Filter templates based on active tab and search query
   * Memoized to prevent unnecessary recalculations on render
   */
  const filteredTemplates = useMemo(() => {
    const query = debouncedSearchQuery.toLowerCase()

    return templates.filter((template) => {
      const tabMatch =
        activeTab === 'gallery' ? template.status === 'approved' : template.status === 'pending'

      if (!tabMatch) return false

      if (!query) return true

      const searchableText = [template.name, template.details?.tagline, template.creator?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }, [templates, activeTab, debouncedSearchQuery])

  /**
   * Get empty state message based on current filters
   * Memoized to prevent unnecessary recalculations on render
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
      gallery: {
        title: 'No templates available',
        description: 'Templates will appear once approved',
      },
    }

    return messages[activeTab as keyof typeof messages] || messages.gallery
  }, [debouncedSearchQuery, activeTab])

  return (
    <div className='flex h-[100vh] flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[28px] pb-[24px]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#1E3A5A] bg-[#0F2A3D]'>
                <Layout className='h-[14px] w-[14px] text-[#60A5FA]' />
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
