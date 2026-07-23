import { cn } from '@sim/emcn'
import Image from 'next/image'
import { LandingHeroHeader } from '@/app/(landing)/components/hero/components/hero-header'
import { HeroPlatformLoop } from '@/app/(landing)/components/hero/components/hero-platform-loop'
import {
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_HERO_TOP_PADDING,
} from '@/app/(landing)/components/landing-layout'
import { TrustedBy } from '@/app/(landing)/components/trusted-by'

/**
 * Landing hero - the only `<h1>` on the page.
 *
 * A single stacked flow (no split panels): headline and the sign-up row sit
 * left-aligned at the top; below them a full-width media frame
 * previews the platform UI; the customer-logo row closes the section centered
 * underneath. The section is capped and centered at the shared `max-w-[1460px]`
 * (`mx-auto`) with the `px-20 max-lg:px-8 max-sm:px-5` gutter so the headline
 * starts on the navbar wordmark's vertical line.
 *
 * Text blocks stack a uniform 22px apart (`gap-[22px]`); the media frame and
 * logo row carry their own larger top margins to read as separate bands.
 *
 * The sign-up row is the shared {@link HeroCta} - the single source of truth for
 * the email-capture bar and the "Book a demo" / "Sign up" chips - reused
 * verbatim by every platform and solutions hero so the primary CTA never drifts.
 *
 * The media frame: the painted landscape backdrop (`hero-backdrop.jpg`,
 * rendered via `next/image` `fill` + `object-cover` with `priority` - it is the
 * LCP element) behind a white window (a soft three-part shadow stack:
 * `0 0 0 1px rgba(0,0,0,0.08)` ring in place of a CSS border, plus
 * `0 2px 6px rgba(0,0,0,0.05)` contact and `0 4px 42px rgba(0,0,0,0.06)`
 * ambient shadows; no browser toolbar) filled edge to edge by the REAL
 * platform UI - a 2x
 * screenshot (`hero-platform-ui.png`, 2560x1470: a 1280x735 layout shown in
 * the 1080x620 window, so the UI reads at 84.4% - the "mini app" type scale
 * cursor.com's demo window uses) of the chat-everywhere two-pane (seeded
 * Mothership chat left, staged workflow right) captured from the
 * `readme-tour-capture` route via
 * `exports/readme-banner/capture-hero-platform.mjs`. The window is
 * `rounded-[10px]` - matching cursor.com's demo window - and the shot's
 * workspace container renders at the concentric inner radius `4px` (outer
 * 10px - 6px gap; overridden at capture time from the chrome's 8px). Only the
 * SIDEBAR
 * remains visible from the shot: the {@link HeroPlatformLoop} island overlays
 * the container interior (full-width chat that stages the workflow pane in,
 * replaying the conversation with the goo ThinkingLoader), inset a hair INSIDE
 * the shot's own baked outlines so the visible chrome is the real UI's pixels
 * - never re-drawn.
 * The frame is `1300/720` and the window `1080/620` at `83.08%` width, centered
 * - matching cursor.com's hero media proportions, with backdrop showing on all
 * four sides. Decorative, `aria-hidden`; the `--surface-3` fill remains as the
 * loading fallback under the backdrop.
 *
 * The headline/CTA column shares its row with the right-aligned
 * {@link HeroStat} (the "Global work done by Sim" figure with its vertical
 * progress rail and staggered page-load entrance), hidden below `lg` where
 * the row has no room.
 *
 * The shared {@link TrustedBy} block renders in its `row` layout - a centered
 * muted label above a single centered row of bare wordmarks.
 *
 * Carries the sr-only ~50-word product summary for AI citation (CLAUDE.md → GEO).
 */
export function Hero() {
  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      className={cn(
        'flex flex-col items-start gap-[22px] text-left',
        LANDING_CONTENT_WIDTH,
        LANDING_GUTTER,
        LANDING_HERO_TOP_PADDING
      )}
    >
      <p className='sr-only'>
        Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect
        1,000+ integrations and every major LLM to create agents that automate real work, visually,
        conversationally, or with code. Trusted by over 100,000 builders, SOC2 compliant, and
        production-ready for teams of every size.
      </p>

      <LandingHeroHeader
        headingId='hero-heading'
        heading={
          <>
            Sim is the AI workspace for <br />
            building and managing AI agents.
          </>
        }
        description='Sim is an AI agent and workflow builder for teams creating agents that automate real work. Design workflows visually, describe what you need in natural language, or use code for complete control.'
        definition='Connect your agents to 1,000+ integrations and every major LLM, then deploy, monitor, and improve them from one collaborative workspace.'
      />

      <div
        aria-hidden='true'
        className='relative mt-[34px] aspect-[1300/720] w-full overflow-hidden rounded-lg bg-[var(--surface-3)] max-sm:aspect-[4/3]'
      >
        <Image
          src='/landing/hero-backdrop.jpg'
          alt=''
          fill
          priority
          fetchPriority='high'
          quality={90}
          sizes='(max-width: 1460px) 100vw, 1300px'
          className='object-cover'
        />
        <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex aspect-[1080/620] w-[83.08%] flex-col overflow-hidden rounded-[10px] bg-[var(--surface-1)] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]'>
          <div className='relative flex-1'>
            <Image
              src='/landing/hero-platform-ui.png'
              alt=''
              fill
              priority
              sizes='(max-width: 1460px) 83vw, 1080px'
              className='object-cover object-left-top'
            />
            <HeroPlatformLoop />
          </div>
        </div>
      </div>

      <TrustedBy layout='row' className='mt-[42px] w-full max-sm:mt-6' />
    </section>
  )
}
