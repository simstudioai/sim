import { Logos } from '@/app/(landing)/components/logos'

/**
 * Solutions logos row - the same customer wordmarks as the landing hero, in a
 * single horizontally-centered row at the shared `gap-x-24` rhythm (owned by the
 * shared {@link Logos} component, `row` layout). Takes no props and exposes no
 * spacing: its horizontal gutter comes from `SolutionsPage` and its inter-section
 * spacing from the page's `<main>` gap.
 *
 * Wrapped as a labelled `<section>` so it is a discrete, crawlable landmark; the
 * heading is sr-only because the logos are a proof band rather than a content
 * section, but the H2 keeps the page's heading hierarchy intact. The section is
 * `relative` so the `sr-only` (`position: absolute`) heading is contained by it
 * rather than falling back to the document root - matching {@link Features}'s
 * `relative` wrapper for its own `sr-only` heading, and avoiding a phantom root
 * scrollbar (the heading's un-offset static position would otherwise inflate
 * `document.documentElement`'s scroll height by its own position in the page).
 */
export function SolutionsLogosRow() {
  return (
    <section id='solutions-logos' aria-labelledby='solutions-logos-heading' className='relative'>
      <h2 id='solutions-logos-heading' className='sr-only'>
        Companies building AI agents with Sim
      </h2>
      <div className='flex justify-center'>
        <Logos layout='row' />
      </div>
    </section>
  )
}
