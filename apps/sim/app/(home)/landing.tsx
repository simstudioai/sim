import {
  Collaboration,
  Enterprise,
  Features,
  Footer,
  Hero,
  Navbar,
  Pricing,
  StructuredData,
  Templates,
  Testimonials,
} from '@/app/(home)/components'

/**
 * Landing page root component.
 *
 * ## SEO Architecture
 * - Single `<h1>` inside Hero (only one per page).
 * - Heading hierarchy: H1 (Hero) -> H2 (each section) -> H3 (sub-items).
 * - Semantic landmarks: `<header>`, `<main>`, `<footer>`.
 * - Every `<section>` has an `id` for anchor linking and `aria-labelledby` for accessibility.
 * - `StructuredData` emits JSON-LD before any visible content.
 *
 * ## GEO Architecture
 * - Above-fold content (Navbar, Hero) is statically rendered (Server Components where possible)
 *   for immediate availability to AI crawlers.
 * - Section `id` attributes serve as fragment anchors for precise AI citations.
 * - Content ordering prioritizes answer-first patterns: definition (Hero) ->
 *   examples (Templates) -> capabilities (Features) -> social proof (Collaboration, Testimonials) ->
 *   pricing (Pricing) -> enterprise (Enterprise).
 */
export default function Landing() {
  return (
    <>
      <StructuredData />
      <header>
        <Navbar />
      </header>
      <main>
        <Hero />
        <Templates />
        <Features />
        <Collaboration />
        <Pricing />
        <Enterprise />
        <Testimonials />
      </main>
      <Footer />
    </>
  )
}
