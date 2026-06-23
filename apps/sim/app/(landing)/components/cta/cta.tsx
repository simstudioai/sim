import { ChipLink } from '@/components/emcn'

/**
 * Landing pre-footer CTA — the page's final conversion band. A tall, centered
 * stack modeled on Linear's closing CTA: a large headline over two pill
 * actions — a primary "Get started" routing to sign-up and an outline
 * "Contact sales" routing to the contact form.
 *
 * The band carries its own vertical padding (`py-[120px]`) so it reads
 * as a spacious closing moment rather than just another section; inter-section
 * spacing above is still owned by the `<main>` flex `gap` in `landing.tsx`.
 * Horizontal padding (`px-12`) matches every section above, and the section is
 * capped and centered at the shared `max-w-[1446px]`.
 */
export function Cta() {
  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='mx-auto flex w-full max-w-[1446px] flex-col items-center gap-10 px-12 py-[120px] text-center max-sm:px-5 max-sm:py-16 max-lg:gap-8 max-lg:px-8 max-lg:py-24'
    >
      <h2
        id='cta-heading'
        className='max-w-[860px] text-balance text-[64px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.02em] max-sm:text-[36px] max-lg:text-[48px]'
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
