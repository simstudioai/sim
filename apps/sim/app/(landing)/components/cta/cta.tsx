import { ChipLink } from '@sim/emcn'

/**
 * Landing pre-footer CTA - the page's final conversion band. A tall, centered
 * closing band with a large headline over two pill actions - a primary
 * "Get started" routing to sign-up and an outline "Contact sales" routing to
 * the demo-booking page.
 *
 * The band carries no vertical padding of its own: its spacious closing moment
 * comes from the uniform inter-section `gap` (owned by the `<main>` flex in
 * `landing.tsx`) above it and the `Footer`'s top margin below it. The headline
 * mirrors the hero `<h1>` exactly (48px / `leading-[1.1]` and the same responsive
 * ramp), so the page opens and closes on the same display size. Horizontal
 * padding (`px-20`) matches every section above, and the section is capped and
 * centered at the shared `max-w-[1460px]`.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='mx-auto flex w-full max-w-[1460px] flex-col items-center gap-[22px] px-20 text-center max-sm:px-5 max-lg:px-8'
    >
      <h2
        id='cta-heading'
        className='max-w-[860px] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
      >
        Build your first agent today.
      </h2>
      <div className='flex items-center gap-1'>
        <ChipLink variant='primary' href='/signup' prefetch={false}>
          Get started
        </ChipLink>
        <ChipLink href='/demo' className='border border-[var(--border-1)]'>
          Contact sales
        </ChipLink>
      </div>
    </section>
  )
}
