import { Features, Hero, LandingShell, Lifecycle } from '@/app/(landing)/components'

/**
 * Landing page root — owns the section order and the `<main>` content region.
 *
 * The shared {@link LandingShell} wraps this in the `light` token-pinning
 * wrapper, the scroll port, the skip link, the navbar (with build/revalidate-time
 * GitHub stars), and the footer — the same chrome every platform page wears, so
 * the home page and the platform pages can never drift.
 *
 * `<main>` is a `flex flex-col` whose `gap` is the single source of truth for
 * inter-section rhythm — sections carry no vertical margin/padding of their own,
 * so one knob keeps every section break uniform across the page. Each section
 * component owns its own landmark (`<section id aria-labelledby>`).
 */
export default function Landing() {
  return (
    <LandingShell>
      <main id='main-content' className='flex flex-col gap-[120px]'>
        <Hero />
        <Lifecycle />
        <Features />
        {/* <Testimonials /> */}
      </main>
    </LandingShell>
  )
}
