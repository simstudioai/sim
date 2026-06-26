import { ChipLink } from '@/components/emcn'

/**
 * Landing pre-footer CTA — the page's final conversion band. A tall, centered
 * stack modeled on Linear's closing CTA: a large headline over two pill
 * actions — a primary "Get started" routing to sign-up and an outline
 * "Contact sales" routing to the contact form.
 *
 * The band carries no vertical padding of its own: its spacious closing moment
 * comes from the uniform inter-section `gap` (owned by the `<main>` flex in
 * `landing.tsx`) above it and the `Footer`'s top margin below it. The headline
 * mirrors the hero `<h1>` exactly (48px / `leading-[1.1]` and the same responsive
 * ramp), so the page opens and closes on the same display size. Horizontal
 * padding (`px-12`) matches every section above, and the section is capped and
 * centered at the shared `max-w-[1446px]`.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='mx-auto flex w-full max-w-[1446px] flex-col items-center gap-[22px] px-12 text-center max-sm:px-5 max-lg:px-8'
    >
      <h2
        id='cta-heading'
        className='max-w-[860px] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
      >
        Build your first agent today.
      </h2>
      <div className='flex items-center gap-3'>
        <ChipLink variant='primary' href='/signup'>
          Get started
        </ChipLink>
        <ChipLink href='/contact' className='border border-[var(--border-1)]'>
          Contact sales
        </ChipLink>
      </div>
    </section>
  )
}
