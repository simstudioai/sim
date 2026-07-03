import { Logos } from '@/app/(landing)/components/logos'

/**
 * Platform logos row - the same customer wordmarks as the landing hero, in a
 * single horizontally-centered row at the shared `gap-x-24` rhythm (owned by the
 * shared {@link Logos} component, `row` layout). Takes no props and exposes no
 * spacing: its horizontal gutter comes from `PlatformPage` and its inter-section
 * spacing from the page's `<main>` gap.
 *
 * Wrapped as a labelled `<section>` so it is a discrete, crawlable landmark; the
 * heading is sr-only because the logos are a proof band rather than a content
 * section, but the H2 keeps the page's heading hierarchy intact.
 */
export function PlatformLogosRow() {
  return (
    <section id='platform-logos' aria-labelledby='platform-logos-heading'>
      <h2 id='platform-logos-heading' className='sr-only'>
        Companies building AI agents with Sim
      </h2>
      <div className='flex justify-center'>
        <Logos layout='row' />
      </div>
    </section>
  )
}
