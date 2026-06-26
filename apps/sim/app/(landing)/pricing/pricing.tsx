import { LandingShell } from '@/app/(landing)/components'
import { PricingPlans } from '@/app/(landing)/pricing/components/pricing-plans'
import { PricingStructuredData } from '@/app/(landing)/pricing/components/pricing-structured-data'

/**
 * sr-only product summary — an atomic citation target for AI answer engines that
 * names Sim, the AI workspace, AI agents, and every plan tier.
 */
const GEO_SUMMARY =
  'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Pricing scales across four plans — Free to start, Pro for growing teams, Max for scaling businesses, and Enterprise for large organizations — each connecting 1,000+ integrations and every major LLM.'

/**
 * Public `/pricing` page — the same four plans as the in-app Upgrade page,
 * rendered flat on the landing background for logged-out visitors (no workspace
 * chrome: no back bar, no scroll-port panel, no surrounding container). Each plan
 * is a self-contained card with the full comparison breakdown transposed into it
 * — there is no separate comparison table and no show/hide toggle, so the four
 * cards read as one spec sheet.
 *
 * Server-first by design. This component owns the page frame: the shared
 * {@link LandingShell} (light tokens, navbar, footer), the `<main>` region, the
 * `#pricing` section landmark, the shared landing gutter, the JSON-LD
 * {@link PricingStructuredData}, and the `<h1>` + sr-only GEO summary. The lone
 * `<h1>` and that summary are authored here, next to the page metadata, and
 * handed into the {@link PricingPlans} island as a server-rendered `heading`
 * slot — so the crawlable copy stays out of the client bundle while sitting in
 * the same centered cluster as the billing toggle.
 *
 * The only client cost is {@link PricingPlans}, which owns the single `isAnnual`
 * state shared by the toggle and every card's price. Prices, credits, features,
 * and CTA labels derive from the shared upgrade plan constants, so the plans stay
 * aligned with the in-app Upgrade page.
 */
export default function Pricing() {
  return (
    <LandingShell>
      <main id='main-content'>
        <PricingStructuredData />
        <section
          id='pricing'
          aria-labelledby='pricing-heading'
          className='mx-auto flex w-full max-w-[1446px] flex-col gap-7 px-12 pt-8 max-sm:px-5 max-lg:px-8'
        >
          <PricingPlans
            heading={
              <>
                <h1
                  id='pricing-heading'
                  className='text-balance text-center text-[30px] text-[var(--text-primary)]'
                >
                  Plans that scale with you
                </h1>
                <p className='sr-only'>{GEO_SUMMARY}</p>
              </>
            }
          />
        </section>
      </main>
    </LandingShell>
  )
}
