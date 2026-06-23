import { ChipLink } from '@/components/emcn'

/**
 * The canonical landing call-to-action — a 360px email-capture bar with an
 * inset "Book a demo" action, beside a standalone "Sign up" chip. This is the
 * single source of truth for the CTA used by both the landing hero and every
 * platform hero, so the two never drift.
 *
 * The email bar is a no-background input shell — `border-[var(--border-1)]` (the
 * field border) — wrapping a transparent 16px `<input>` and the "Book a demo"
 * action `gap-2` apart; its `pl-3` text gutter and tighter `pr-[5px]` tuck that
 * button evenly into the right corner. Its radius is `rounded-[13px]` —
 * concentric with the inset `rounded-lg` (8px) "Book a demo" chip: outer = inner
 * + the ~5px inset, so the right corners nest cleanly instead of crossing. (A
 * field that wraps an inset action is meant to be a touch rounder than a bare chip.)
 *
 * Both CTAs carry 16px labels via a single font-size knob (`text-[16px]` +
 * `[&>span]:[font-size:inherit]`, overriding the chip's hardcoded `text-sm`) and
 * horizontal padding in `em` so it stays proportional to the text —
 * `px-[0.571em]`, the chip's 8/14 ratio (≈9px at 16px). "Book a demo" sits
 * inside the bar and scales its height too (`h-[2.143em]`); the standalone
 * "Sign up" is the default chip overridden to the bar's `border-[var(--border-1)]`
 * and `rounded-[13px]` at `h-[44px]` — so the two CTAs share one corner radius and
 * their borders line up exactly.
 *
 * Server Component — the bare `<input>` is uncontrolled and submits via the
 * "Book a demo" link, so no client island is needed here. Owns its own chrome
 * and internal spacing; consumers place it in their own stack and pass nothing.
 */
export function HeroCta() {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <div className='flex h-[44px] w-[360px] items-center gap-2 rounded-[13px] border border-[var(--border-1)] pr-[5px] pl-3 max-sm:w-full'>
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
        className='h-[44px] rounded-[13px] border border-[var(--border-1)] px-[0.571em] text-[16px] max-sm:justify-center [&>span]:[font-size:inherit] max-sm:[&>span]:flex-none'
      >
        Sign up
      </ChipLink>
    </div>
  )
}
