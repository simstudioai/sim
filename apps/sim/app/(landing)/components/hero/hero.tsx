import { chipBorderShadowRing } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { HeroVisual } from '@/app/(landing)/components/hero/components/hero-visual/hero-visual'
import { HeroCta } from '@/app/(landing)/components/hero-cta'
import { Logos } from '@/app/(landing)/components/logos'

/**
 * Landing hero — the only `<h1>` on the page.
 *
 * The section is the relative positioning context for two absolute panels that
 * split the viewport down the middle — a visual panel on the right, a
 * customer-logo block on the left — over a left-aligned text column.
 *
 * The section is capped and centered at the shared `max-w-[1446px]` (`mx-auto`)
 * — 1350px content plus the two 48px gutters — so on wide screens the whole hero
 * (text column and both absolute panels, which anchor to this box) stays
 * contained and centered rather than stretching edge to edge.
 *
 * Text column (top → bottom, left-aligned): 112px top padding, headline,
 * description, then the sign-up row. Horizontal padding (`px-12`) matches the
 * navbar so the hero text starts on the same vertical line as the wordmark;
 * blocks are stacked a uniform 22px apart (`gap-[22px]`).
 *
 * The sign-up row is the shared {@link HeroCta} — the single source of truth for
 * the email-capture bar and the "Book a demo" / "Sign up" chips — reused
 * verbatim by every platform and solutions hero so the primary CTA never drifts.
 *
 * The headline is split across two lines with a hard break; the reading-order
 * text content is unaffected.
 *
 * The section is sized to exactly one fold — `min-h-[calc(100vh-62px)]`, the
 * viewport minus the 62px navbar — so the two absolute panels can anchor to its
 * top and bottom and stay on-screen.
 *
 * The right-hand visual panel holds the {@link HeroVisual} — a looping,
 * `aria-hidden` product demo and the page's only client island. It is absolutely
 * positioned against the section: its left edge sits at the screen center
 * (`left-1/2`) and its right edge at the hero's right padding (`right-12`), so
 * its width is the right half. Vertically it is inset a uniform 32px from the
 * section's top and bottom (`top-8 bottom-8`) — equal breathing room above and
 * below, extending past the text column's 112px lines so the panel reads as the
 * taller media surface. Below `xl` the split collapses and the panel goes in-flow
 * (`max-xl:static`) with a stable aspect ratio so the stacked hero never shifts.
 * Chrome is the `border-shadow` chip surface — a `rounded-lg` panel on
 * `--surface-2` carrying the shared {@link chipBorderShadowRing} (a 1px hairline
 * ring plus a soft drop shadow); `overflow-hidden` clips the visual to the radius.
 *
 * The shared {@link Logos} grid (the same logo set every platform and solutions
 * page uses) sits in a bottom-anchored panel that mirrors the visual panel on
 * the left half (`left-12` → `right-1/2`, same `top-8 bottom-8` frame).
 * `flex flex-col justify-end` pins the grid to the bottom, then `pb-20` lifts it
 * 80px above the panel's bottom edge, leaving the logos resting 112px above the
 * section bottom — mirroring the hero text's 112px from the top. The frame
 * overlays the text column, so it is `pointer-events-none`.
 *
 * Carries the sr-only ~50-word product summary for AI citation (CLAUDE.md → GEO).
 */
export function Hero() {
  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      className='relative mx-auto flex min-h-[calc(100vh-62px)] w-full max-w-[1446px] flex-col items-start gap-[22px] px-12 pt-[112px] text-left max-sm:px-5 max-sm:pt-12 max-xl:min-h-0 max-xl:gap-5 max-xl:px-8 max-xl:pt-20 max-xl:pb-4'
    >
      <p className='sr-only'>
        Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect
        1,000+ integrations and every major LLM to create agents that automate real work — visually,
        conversationally, or with code. Trusted by over 100,000 builders, SOC2 compliant, and
        production-ready for teams of every size.
      </p>

      <h1
        id='hero-heading'
        className='text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
      >
        Your workflow agent
        <br />
        for AI automations.
      </h1>

      <p className='text-lg text-[var(--text-body)] leading-[1.5] max-sm:text-md [&>br]:max-sm:hidden'>
        Sim is the collaborative workspace to build, deploy, <br /> and manage AI agents and
        workflows.
      </p>

      <HeroCta />

      <div
        aria-hidden='true'
        className={cn(
          'absolute top-8 right-12 bottom-8 left-1/2 overflow-hidden rounded-lg bg-[var(--surface-2)]',
          chipBorderShadowRing,
          'max-sm:mt-3 max-sm:aspect-[5/4] max-xl:static max-xl:mt-6 max-xl:aspect-[16/10] max-xl:w-full'
        )}
      >
        <HeroVisual />
      </div>

      <div className='pointer-events-none absolute top-8 right-1/2 bottom-8 left-12 flex flex-col justify-end pb-20 max-sm:mt-8 max-xl:static max-xl:mt-10 max-xl:w-full max-xl:pb-0'>
        <Logos layout='grid' />
      </div>
    </section>
  )
}
