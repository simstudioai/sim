/**
 * Landing ethos band — a single large statement that closes the page's
 * argument before the footer CTA. Drawn from the brand ethos: a fleet you
 * command, not one you tend. New copy, kept in the constitution's register
 * ("AI agents", direct and plain) — it is inspiration, not a quote.
 *
 * One statement, split across the headline and body colors like the section
 * `<h2>`s above, set larger because it is the page's closing line rather than a
 * section title. Inter-section spacing is owned by the `<main>` flex `gap` in
 * `landing.tsx`; horizontal padding (`px-12`) matches every section above, and
 * the section is capped and centered at the shared `max-w-[1446px]`.
 */
export function Ethos() {
  return (
    <section
      id='ethos'
      aria-labelledby='ethos-heading'
      className='mx-auto w-full max-w-[1446px] px-12'
    >
      <h2
        id='ethos-heading'
        className='max-w-[900px] text-balance text-[44px] leading-[1.2] tracking-[-0.01em]'
      >
        <span className='text-[var(--text-primary)]'>You direct it. It executes.</span>{' '}
        <span className='text-[var(--text-body)]'>
          The work that used to fill your day becomes work you command.
        </span>
      </h2>
    </section>
  )
}
