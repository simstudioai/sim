import { CtaChat } from '@/app/(landing)/components/cta/components/cta-chat'

/**
 * Landing pre-footer CTA — the page's final conversion band. A clean, centered
 * stack: the "Build your first agent today." headline over a live Mothership
 * chat input ({@link CtaChat}). The visitor's first prompt is the call to
 * action — typing and sending routes them into Sim's sign-up flow with their
 * message preserved.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * horizontal padding (`px-12`) matches every section above, and the section is
 * capped and centered at the shared `max-w-[1446px]`.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='mx-auto flex w-full max-w-[1446px] flex-col items-center gap-8 px-12 text-center'
    >
      <h2
        id='cta-heading'
        className='max-w-[720px] text-balance text-[40px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em]'
      >
        Build your first agent today.
      </h2>
      <CtaChat />
    </section>
  )
}
