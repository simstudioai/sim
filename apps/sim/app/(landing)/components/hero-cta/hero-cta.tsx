import { ChipLink } from '@/components/emcn'

/**
 * The canonical landing call-to-action — a 360px email-capture bar with an
 * inset "Book a demo" action, beside a standalone "Sign up" chip. This is the
 * single source of truth for the CTA used by both the landing hero and every
 * platform hero, so the two never drift.
 *
 * The email bar is a no-background input shell — `border-[var(--border-1)]` (the
 * field border) — wrapping a transparent 16px `<input>` and the "Book a demo"
 * action `gap-2` apart; its `pl-3` text gutter and tighter `pr-[4px]` tuck that
 * button evenly into the right corner. Its radius is `rounded-lg` (8px, the navbar
 * chip radius); the inset `rounded-md` (6px) "Book a demo" chip echoes that curve,
 * tucked inside the 4px inset (a hair under the bar's 8px, so the corners don't cross).
 *
 * Both CTAs carry 16px labels via a single font-size knob (`text-[16px]` +
 * `[&>span]:[font-size:inherit]`, overriding the chip's hardcoded `text-sm`) and
 * horizontal padding in `em` so it stays proportional to the text —
 * `px-[0.571em]` (the chip's 8/14 ratio) and `h-[2.143em]` (its 30/14 ratio), so
 * "Book a demo" keeps the navbar chip's exact proportions; the standalone
 * "Sign up" is the default chip overridden to the bar's `border-[var(--border-1)]`
 * and `rounded-lg` at `h-[40px]` — so the two CTAs share one corner radius and
 * their borders line up exactly.
 *
 * Server Component — the bare `<input>` is uncontrolled and submits via the
 * "Book a demo" link, so no client island is needed here. Owns its own chrome
 * and internal spacing; consumers place it in their own stack and pass nothing.
 */
export function HeroCta() {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <div className='flex h-[40px] w-[360px] items-center gap-2 rounded-lg border border-[var(--border-1)] pr-[4px] pl-3 max-sm:w-full'>
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
          className='h-[2.143em] rounded-md px-[0.571em] text-[16px] [&>span]:[font-size:inherit]'
        >
          Book a demo
        </ChipLink>
      </div>
      <ChipLink
        href='/signup'
        flush
        className='h-[40px] rounded-lg border border-[var(--border-1)] px-[0.571em] text-[16px] max-sm:justify-center [&>span]:[font-size:inherit] max-sm:[&>span]:flex-none'
      >
        Sign up
      </ChipLink>
    </div>
  )
}
