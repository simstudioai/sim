'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { HomeSection } from '@/components/home/home-section'
import { OAUTH_SEARCH_READ_SCOPE, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useSearchSourceOverview } from '@/hooks/queries/kb/connectors'
import { useAuthorizedApps } from '@/hooks/queries/oauth-provider'

type StepId = 'connect-integration' | 'connect-sim-search'

interface GetStartedStep {
  id: StepId
  label: string
}

/** The onboarding steps, in the order a new organization works through them. */
const STEPS: readonly GetStartedStep[] = [
  { id: 'connect-integration', label: 'Connect an integration' },
  { id: 'connect-sim-search', label: 'Connect Sim Search MCP' },
]

const ROW_CLASS =
  'flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]'

/**
 * A step's leading mark: an empty ring until the step is done, then the
 * completion blue filled behind a check. The check is drawn here at the ring's
 * own scale rather than with the 24-unit house icon — scaled to 10px, that
 * stroke thins to a hair and its optical center drifts above the box. The svg
 * fills the ring's 14px content box (16px less the 1px border on each side), so
 * the path's center is the ring's center, and its stroke lands at ~1px — the
 * weight the house icons render at 16px.
 */
function StepMark({ complete }: { complete: boolean }) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'flex size-[16px] shrink-0 items-center justify-center rounded-full border',
        complete ? 'border-[var(--brand-blue)] bg-[var(--brand-blue)]' : 'border-[var(--border)]'
      )}
    >
      {complete && (
        <svg
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.2'
          strokeLinecap='round'
          strokeLinejoin='round'
          className='size-[14px] text-white'
        >
          <path d='M4.5 8.1L7 10.6L11.5 5.4' />
        </svg>
      )}
    </span>
  )
}

/**
 * The organization home's onboarding list under the composer. Same chrome as
 * the workspace home's suggested actions: a hover-revealed disclosure header
 * over hairline-separated rows. Each step leads to the page that completes it,
 * and reads as done from the organization's real state: a source the viewer can
 * search and an OAuth app authorized to use Search.
 */
export function GetStarted() {
  const { organization, viewer } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const { data: overview } = useSearchSourceOverview(scope)
  const {
    data: authorizedApps,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isError,
  } = useAuthorizedApps('', { enabled: viewer.canUseSearchMcp })
  const hasSearchAuthorization =
    authorizedApps?.pages.some((page) =>
      page.apps.some((app) => oauthScopeSatisfies(app.scopes, OAUTH_SEARCH_READ_SCOPE))
    ) ?? false

  const hrefs: Record<StepId, string> = {
    'connect-integration': viewer.isAdmin
      ? routes.settingsSection('integrations')
      : routes.integrations,
    'connect-sim-search': routes.settingsSection('search-mcp'),
  }
  const completed: Record<StepId, boolean> = {
    'connect-integration': overview?.hasSearchableDocuments === true,
    'connect-sim-search': hasSearchAuthorization,
  }
  const steps = STEPS.filter((step) => step.id !== 'connect-sim-search' || viewer.canUseSearchMcp)

  const [expanded, setExpanded] = useState(true)
  /**
   * Collapsible animations are enabled only after the first user toggle, so
   * the initially-open, server-rendered panel appears at full height on first
   * paint instead of replaying the open animation and shifting the input
   * above it.
   */
  const [animationsEnabled, setAnimationsEnabled] = useState(false)

  useEffect(() => {
    if (
      viewer.canUseSearchMcp &&
      !hasSearchAuthorization &&
      hasNextPage &&
      !isFetching &&
      !isError
    ) {
      void fetchNextPage()
    }
  }, [
    viewer.canUseSearchMcp,
    hasSearchAuthorization,
    hasNextPage,
    isFetching,
    isError,
    fetchNextPage,
  ])

  const handleToggleExpanded = () => {
    setAnimationsEnabled(true)
    setExpanded((prev) => !prev)
  }

  return (
    <HomeSection
      title='Get started'
      expanded={expanded}
      animationsEnabled={animationsEnabled}
      onToggle={handleToggleExpanded}
    >
      {steps.map((step, i) => {
        const complete = completed[step.id]
        return (
          <Link key={step.id} href={hrefs[step.id]} className={cn(ROW_CLASS, i > 0 && 'border-t')}>
            <StepMark complete={complete} />
            <span
              className={cn(
                'flex-1 truncate text-sm',
                complete ? 'text-[var(--brand-blue)]' : 'text-[var(--text-body)]'
              )}
            >
              {step.label}
            </span>
            <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
          </Link>
        )
      })}
    </HomeSection>
  )
}
