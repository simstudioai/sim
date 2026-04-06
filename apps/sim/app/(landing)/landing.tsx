import { getNavBlogPosts } from '@/lib/blog/registry'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'
import {
  Collaboration,
  // Enterprise,
  Features,
  Footer,
  Hero,
  Navbar,
  Pricing,
  StructuredData,
  Templates,
  Testimonials,
} from '@/app/(landing)/components'
import { LandingAnalytics } from '@/app/(landing)/landing-analytics'

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
 *   examples (Templates) -> capabilities (Features) -> social proof (Collaboration) ->
 *   enterprise (Enterprise) -> pricing (Pricing) -> testimonials (Testimonials).
 */
export default async function Landing() {
  const blogPosts = await getNavBlogPosts()

  return (
    <div
      className={`${season.variable} ${martianMono.variable} min-h-screen bg-[var(--landing-bg)]`}
    >
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-medium focus:text-black focus:text-sm'
      >
        Skip to main content
      </a>
      <LandingAnalytics />
      <StructuredData />
      <header>
        <Navbar blogPosts={blogPosts} />
      </header>
      <main id='main-content'>
        <article itemScope itemType='https://schema.org/WebPage'>
          <meta itemProp='name' content='Sim — Build AI Agents & Run Your Agentic Workforce' />
          <meta
            itemProp='description'
            content='Sim is the open-source platform to build AI agents and run your agentic workforce.'
          />
          <Hero />
          <Templates />
          <Features />
          <Collaboration />
          {/* <Enterprise /> */}
          <Pricing />
          <Testimonials />
        </article>
      </main>
      <Footer />
    </div>
  )
}
