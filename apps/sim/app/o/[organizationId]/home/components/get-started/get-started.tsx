'use client'

import { useState } from 'react'
import { cn, Expandable, ExpandableContent } from '@sim/emcn'
import { ArrowRight, ChevronDown } from '@sim/emcn/icons'
import Link from 'next/link'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useApiKeys } from '@/hooks/queries/api-keys'
import { useSearchSources } from '@/hooks/queries/kb/connectors'

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
 * search and a personal API key for the MCP server.
 */
export function GetStarted() {
  const { organization, viewer } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const { data: sources } = useSearchSources(scope)
  const { data: apiKeys } = useApiKeys('', 'personal')

  const hrefs: Record<StepId, string> = {
    'connect-integration': viewer.isAdmin
      ? routes.settingsSection('integrations')
      : routes.integrations,
    'connect-sim-search': routes.settingsSection('search-mcp'),
  }
  const completed: Record<StepId, boolean> = {
    'connect-integration':
      sources?.some(
        (source) => source.viewerMembership === 'connected' || !source.connectionRequired
      ) ?? false,
    'connect-sim-search': (apiKeys?.personalKeys.length ?? 0) > 0,
  }

  const [expanded, setExpanded] = useState(true)
  /**
   * Collapsible animations are enabled only after the first user toggle, so
   * the initially-open, server-rendered panel appears at full height on first
   * paint instead of replaying the open animation and shifting the input
   * above it.
   */
  const [animationsEnabled, setAnimationsEnabled] = useState(false)

  const handleToggleExpanded = () => {
    setAnimationsEnabled(true)
    setExpanded((prev) => !prev)
  }

  return (
    <div className='group/suggested mx-auto mt-7 w-full max-w-chat'>
      {/* Full width so the whole line toggles, not just the label and chevron. */}
      <button
        type='button'
        onClick={handleToggleExpanded}
        aria-expanded={expanded}
        className='group/toggle flex w-full cursor-pointer items-center gap-2'
      >
        <span className='text-[var(--text-muted)] text-caption'>Get started</span>
        {/*
         * Revealed by hovering anywhere in the section — the group sits on the
         * section wrapper rather than this row, so the rows below arm it just as
         * the header does. Focus is keyed off the toggle instead, the only element
         * here that can hold it, and matters because globals clear focus outlines.
         * One transition covers the fade and the rotation so the two cannot drift
         * apart. Mirrors the sidebar's section headers.
         */}
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] opacity-0 transition-[opacity,transform] duration-150',
            'group-hover/suggested:opacity-100 group-focus-visible/toggle:opacity-100',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent className={cn(!animationsEnabled && 'animate-none!')}>
          {/* 6px, matching a sidebar section header to its first item — both headers
              are an 18px box around 12px text, so equal padding reads as equal
              distance. Padding an inner wrapper rather than the animated element:
              `collapsible-up`/`-down` interpolate height alone, so a margin here
              would hold its full value through the close and then vanish on unmount,
              snapping the content below up. */}
          <div className='flex flex-col pt-1.5'>
            {STEPS.map((step, i) => {
              const complete = completed[step.id]
              return (
                <Link
                  key={step.id}
                  href={hrefs[step.id]}
                  className={cn(ROW_CLASS, i > 0 && 'border-t')}
                >
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
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
