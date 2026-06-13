import { ChipLink } from '@/components/emcn'
import { HeroVisual } from '@/app/(landing)/components/hero/components/hero-visual/hero-visual'
import { HeroLogos } from '@/app/(landing)/components/hero/components/logos'

/**
 * Landing hero — the only `<h1>` on the page.
 *
 * The section is the relative positioning context for two absolute panels that
 * split the viewport down the middle — a visual panel on the right, a
 * customer-logo block on the left — over a left-aligned text column.
 *
 * Text column (top → bottom, left-aligned): 112px top padding, headline,
 * description, then the sign-up row. Horizontal padding (`px-16`) matches the
 * navbar so the hero text starts on the same vertical line as the wordmark;
 * blocks are stacked a uniform 22px apart (`gap-[22px]`).
 *
 * The sign-up row places the email-capture bar and a "Sign up" button side by
 * side, `gap-2` apart, matched to the same 44px visual height. The bar is a
 * no-background input
 * shell — `rounded-lg` (the chip roundedness) and `border-[var(--border-1)]`
 * (the `UserInput` border) — wrapping a transparent 16px `<input>` and the
 * "Book a demo" action `gap-2` apart; its `pl-3` text gutter and tighter
 * `pr-[5px]` tuck that button evenly into the right corner.
 *
 * Both CTAs carry 16px labels via a single font-size knob (`text-[16px]` +
 * `[&>span]:[font-size:inherit]`, overriding the chip's hardcoded `text-sm`)
 * and horizontal padding in `em` so it stays proportional to the text —
 * `px-[0.571em]`, the chip's 8/14 ratio (≈9px at 16px). "Book a demo" sits
 * inside the bar and scales its height too (`h-[2.143em]`); the standalone
 * "Sign up" is the default chip with a `border border-[var(--border-1)]` (the
 * bar's border) at `h-[44px]` — both borders sit inside their border-box
 * height, so the two edges line up exactly.
 *
 * The headline is split across two lines with a hard break; the reading-order
 * text content is unaffected.
 *
 * The section is sized to exactly one fold — `min-h-[calc(100vh-62px)]`, the
 * viewport minus the 62px navbar (its `py-4` + `h-[30px]` chips) — so the two
 * absolute panels can anchor to its top and bottom and stay on-screen.
 *
 * The right-hand visual panel holds the {@link HeroVisual} — a looping,
 * `aria-hidden` product demo (home → typed prompt → GitHub→Agent→Jira workflow
 * with data flowing) and the page's only client island. It is absolutely
 * positioned against the section: its left edge sits at the screen center
 * (`left-1/2`), its right edge at the hero's right padding (`right-16`), and it
 * is inset a uniform 32px from the section's top and bottom (`top-8 bottom-8`,
 * the section box top being the navbar's bottom edge) — equal breathing room
 * above and below, never overflowing the fold. Chrome is `rounded-lg` (chip
 * roundedness) + `--surface-2` fill + a 1px `border-[var(--border-1)]` (the same
 * field border as the email-capture bar), sitting inside the border-box so the
 * inset positions are unaffected; `overflow-hidden` clips the future video to
 * the radius.
 *
 * The {@link HeroLogos} grid sits in a bottom-anchored panel that mirrors the
 * visual panel on the left half (`left-16` → `right-1/2`, same `top-8 bottom-8`
 * frame). `flex flex-col justify-end` pins the grid to the bottom, then `pb-20`
 * lifts it 80px above the panel's bottom edge — the same 80px that separates the
 * top of the visual panel (`top-8`, y=32) from the hero text (`pt-[112px]`,
 * y=112). That leaves the logos resting 112px above the section bottom, mirroring
 * the hero text's 112px from the top. The frame overlays the text column, so it
 * is `pointer-events-none` — clicks fall through to the email bar and CTAs.
 *
 * Carries the sr-only ~50-word product summary for AI citation (CLAUDE.md → GEO).
 */
export function Hero() {
  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      className='relative flex min-h-[calc(100vh-62px)] flex-col items-start gap-[22px] px-16 pt-[112px] text-left'
    >
      <p className='sr-only'>
        Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect
        1,000+ integrations and every major LLM to create agents that automate real work — visually,
        conversationally, or with code. Trusted by over 100,000 builders, SOC2 compliant, and
        production-ready for teams of every size.
      </p>

      <h1
        id='hero-heading'
        className='text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] '
      >
        Your workflow agent for
        <br />
        solving automations.
      </h1>

      <p className='text-[20px] text-[var(--text-body)] leading-[1.5]'>
        Sim is the collaborative workspace to build, deploy, <br /> and manage AI agents and
        workflows.
      </p>

      <div className='flex items-center gap-2'>
        <div className='flex h-[44px] w-[360px] items-center gap-2 rounded-lg border border-[var(--border-1)] pr-[5px] pl-3'>
          <input
            type='email'
            aria-label='Email address'
            placeholder='Email address'
            className='h-full min-w-0 flex-1 bg-transparent text-[16px] text-[var(--text-body)] outline-none placeholder:text-[var(--text-muted)]'
          />
          <ChipLink
            variant='primary'
            href='/contact'
            flush
            className='h-[2.143em] px-[0.571em] text-[16px] [&>span]:[font-size:inherit]'
          >
            Book a demo
          </ChipLink>
        </div>
        <ChipLink
          href='/signup'
          flush
          className='h-[44px] border border-[var(--border-1)] px-[0.571em] text-[16px] [&>span]:[font-size:inherit]'
        >
          Sign up
        </ChipLink>
      </div>

      <div
        aria-hidden='true'
        className='absolute top-8 right-16 bottom-8 left-1/2 overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)]'
      >
        <HeroVisual />
      </div>

      <div className='pointer-events-none absolute top-8 right-1/2 bottom-8 left-16 flex flex-col justify-end pb-20'>
        <HeroLogos />
      </div>
    </section>
  )
}
