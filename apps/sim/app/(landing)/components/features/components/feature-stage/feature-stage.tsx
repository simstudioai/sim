import type { ReactNode } from 'react'
import { cn } from '@/lib/core/utils/cn'
import type { SidebarView } from '@/app/(landing)/components/landing-preview/components/landing-preview-sidebar/landing-preview-sidebar'
import { LandingPreviewMount } from '@/app/(landing)/components/landing-preview/landing-preview-mount'

/**
 * One capability beat in {@link Features}: a copy block over a static platform
 * backdrop with an elevated, real-Sim-UI callout floating on the left
 * (Linear's "callout over a faded platform" pattern). The backdrop is the live
 * workspace rendered static (`autoplay={false}`) on whichever {@link SidebarView}
 * matches the beat; three intersected mask layers dissolve its left edge (behind
 * the callout), its far-right edge, and its bottom-right corner into the page so
 * only the relevant surface stays crisp.
 *
 * Heading is an `<h3>` — the section owns the single `<h2>`, each beat is an item
 * beneath it.
 */
const BACKDROP_MASK =
  '[-webkit-mask-composite:source-in] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_48%),linear-gradient(to_left,transparent,#000_16%),linear-gradient(to_top,transparent,#000_30%),radial-gradient(70%_70%_at_100%_100%,transparent,#000_58%)] [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,#000_48%),linear-gradient(to_left,transparent,#000_16%),linear-gradient(to_top,transparent,#000_30%),radial-gradient(70%_70%_at_100%_100%,transparent,#000_58%)]'

interface FeatureStageProps {
  /** Capability name shown as a quiet kicker (e.g. "Mothership", "Pod"). */
  eyebrow: string
  /** The beat's headline. */
  title: string
  /** Supporting line beneath the headline. */
  description: string
  /** Staged platform view for the backdrop. Defaults to `'workflow'`. */
  view?: SidebarView
  /** Workflow staged when `view` is `'workflow'`. */
  workflowId?: string
  /** The elevated real-UI callout (a {@link CalloutFrame}-wrapped surface). */
  callout: ReactNode
}

export function FeatureStage({
  eyebrow,
  title,
  description,
  view,
  workflowId,
  callout,
}: FeatureStageProps) {
  return (
    <div>
      <div className='max-w-[560px]'>
        <span className='text-[13px] text-[var(--text-muted)]'>{eyebrow}</span>
        <h3 className='mt-2 text-balance text-[28px] text-[var(--text-primary)] leading-[1.2] max-sm:text-[22px]'>
          {title}
        </h3>
        <p className='mt-3 text-pretty text-[18px] text-[var(--text-body)] leading-[1.5] max-sm:text-[16px]'>
          {description}
        </p>
      </div>

      <div className='relative mt-20 max-sm:mt-8 max-lg:mt-14'>
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border border-[var(--border-1)]',
            BACKDROP_MASK,
            // On phones the floating callout is hidden, so drop the edge masks
            // (which were carved out behind/around it) and show the full preview.
            'max-md:![mask-image:none] max-md:![-webkit-mask-image:none]'
          )}
        >
          <LandingPreviewMount autoplay={false} view={view} workflowId={workflowId} />
        </div>
        <div className='-top-6 absolute left-10 z-10 max-md:hidden'>{callout}</div>
      </div>
    </div>
  )
}

const CALLOUT_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_72%,transparent)] [mask-image:linear-gradient(to_bottom,#000_72%,transparent)]'

interface CalloutFrameProps {
  /** Width/layout for the panel (e.g. `w-[340px]`). */
  className?: string
  /** Sizing for the inner body (e.g. `h-[300px]`). */
  bodyClassName?: string
  /** Dissolve the body's lower edge so the surface reads as continuing below. */
  fade?: boolean
  children: ReactNode
}

/**
 * The shared chrome for a callout: an elevated white panel (`--border-1`
 * hairline + soft shadow) that lifts a real Sim UI surface off the backdrop.
 * Optionally fades its body's foot so a long surface dissolves rather than ends
 * on a hard edge.
 */
export function CalloutFrame({ className, bodyClassName, fade, children }: CalloutFrameProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[#e6e6e6] bg-[#ffffff] shadow-[0_24px_60px_-24px_rgba(18,18,18,0.28)]',
        className
      )}
    >
      <div className={cn('relative overflow-hidden', fade && CALLOUT_FADE, bodyClassName)}>
        {children}
      </div>
    </div>
  )
}
