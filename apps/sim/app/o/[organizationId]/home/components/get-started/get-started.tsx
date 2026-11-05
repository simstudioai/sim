'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import { HomeSection } from '@/components/home/home-section'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import { useGetStartedSteps } from '@/app/o/[organizationId]/home/components/get-started/use-get-started-steps'

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
 * and reads as done from the organization's real state: a configured integration and an OAuth app authorized to use Search.
 */
export function GetStarted() {
  const steps = useGetStartedSteps()

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

  if (steps.length === 0) return null

  return (
    <HomeSection
      title='Get started'
      expanded={expanded}
      animationsEnabled={animationsEnabled}
      onToggle={handleToggleExpanded}
    >
      {steps.map(({ id, label, href, complete }, i) => {
        return (
          <SettingsGuardedLink key={id} href={href} className={cn(ROW_CLASS, i > 0 && 'border-t')}>
            <StepMark complete={complete} />
            <span
              className={cn(
                'flex-1 truncate text-sm',
                complete ? 'text-[var(--brand-blue)]' : 'text-[var(--text-body)]'
              )}
            >
              {label}
            </span>
            <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
          </SettingsGuardedLink>
        )
      })}
    </HomeSection>
  )
}
