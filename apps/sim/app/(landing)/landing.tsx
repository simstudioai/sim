import {
  Cta,
  Features,
  Hero,
  HomeStructuredData,
  Mothership,
  ProductDemo,
} from '@/app/(landing)/components'

/**
 * Landing page root - owns the section order and the `<main>` content region.
 *
 * The shared chrome (`light` + brand token layer, scroll port, skip link, navbar
 * with build/revalidate-time GitHub stars, footer, and site-wide JSON-LD) is
 * owned by the route-group layout via `LandingShell`, so the landing family can
 * never drift and the navbar persists across navigation. This page emits only
 * its `<main>` and the home-specific structured data.
 *
 * `<main>` is a `flex flex-col` whose `gap` is the single source of truth for
 * inter-section rhythm - sections carry no vertical margin/padding of their own,
 * so one knob keeps every section break uniform across the page. Each section
 * component owns its own landmark (`<section id aria-labelledby>`).
 */
export default function Landing() {
  return (
    <main id='main-content' className='flex flex-col gap-[120px] max-sm:gap-16 max-lg:gap-[88px]'>
      <HomeStructuredData />
      <Hero />
      <ProductDemo />
      <Mothership />
      <Features />
      <Cta />
    </main>
  )
}
