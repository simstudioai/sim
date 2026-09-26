import { type ReactNode, useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import { OrganizationLanding } from '@/app/o/[organizationId]/components/organization-landing'
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
      {searching ? (
        <>
          <div className={PAGE_HEADER_BAR}>
            <div className={HEADER_ACTION_CLUSTER} />
          </div>
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
        <OrganizationLanding heading={`Search ${organization.name}`}>
          {composer}
        </OrganizationLanding>
      )}
    </div>
  )
}
