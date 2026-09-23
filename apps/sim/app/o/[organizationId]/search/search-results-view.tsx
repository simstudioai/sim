import { type ReactNode, useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import { PAGE_COLUMN_CLASS } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

interface SearchResultsViewProps {
  composer: ReactNode
  query: string
  onSummarize: (message: string, filters: WorkspaceSearchFilters) => void
  onSearchChange?: (search: SearchResource) => void
}

/** Standalone Search uses the original centered field and docked results layout. */
export function SearchResultsView({
  composer,
  query,
  onSummarize,
  onSearchChange,
}: SearchResultsViewProps) {
  const { organization } = useOrganizationContext()
  const scope = { kind: 'organization' as const, organizationId: organization.id }
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const searching = query.trim().length > 0
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: searching,
  })
  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>
      {searching ? (
        <>
          <div className={cn(PAGE_COLUMN_CLASS, SIDEBAR_DIVIDER_PAD_ABOVE_CLASS, 'shrink-0 pt-8')}>
            {composer}
          </div>
          <div
            ref={scrollContainerRef}
            className={cn(
              SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
              SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
              scrollFadeClass,
              'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'
            )}
            {...scrollFadeAttributes(scrollEdges)}
          >
            {/* The rows carry their own `px-2`; this gutter brings each row's mark under the
                field's own search glyph, so results read as a column hanging from the field. */}
            <div ref={scrollContentRef} className={cn(PAGE_COLUMN_CLASS, 'px-8')}>
              <KnowledgeSearchResults
                scope={scope}
                query={query}
                onSummarize={onSummarize}
                onSearchChange={onSearchChange}
              />
            </div>
          </div>
        </>
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          {/* Asymmetric padding biases the group up so heading and field sit at the optical center, as on Home */}
          <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
            <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
              Search {organization.name}
            </h1>
            <div className='w-full max-w-chat'>{composer}</div>
          </div>
        </div>
      )}
    </div>
  )
}
