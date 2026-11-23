import { INTEGRATION_COUNT_LABEL } from '@sim/deployment-config/integration-claims'
import {
  ANNUAL_DISCOUNT_RATE,
  CREDITS_PER_DOLLAR,
  DEFAULT_FREE_CREDITS,
  MAX_CREDIT_TIER,
  PRO_CREDIT_TIER,
} from '@/lib/billing/constants'
import { SITE_URL } from '@/lib/core/utils/urls'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import { LandingFAQ } from '@/app/(landing)/components/landing-faq'

const formatCredits = (credits: number) => credits.toLocaleString('en-US')

/**
 * Pricing questions answer engines ask about Sim. Every number reads from the
 * billing constants that drive the plan cards, so the answers cannot drift from
 * the prices shown above them.
 */
const PRICING_FAQS = [
  {
    question: 'Is Sim free?',
    answer: `Yes. The Free plan costs $0 and includes ${formatCredits(DEFAULT_FREE_CREDITS * CREDITS_PER_DOLLAR)} one-time credits, one workspace, and all ${INTEGRATION_COUNT_LABEL} integrations, with no credit card required. On Free, models and tools run on your own provider keys; Sim-hosted keys come with paid plans. Sim is also open source, so you can self-host it for free.`,
  },
  {
    question: 'How much does Sim cost?',
    answer: `Pro is $${PRO_CREDIT_TIER.dollars} per user per month with ${formatCredits(PRO_CREDIT_TIER.credits)} credits a month and a weekly refresh of ${formatCredits(PRO_CREDIT_TIER.weeklyRefreshCredits)} more. Max is $${MAX_CREDIT_TIER.dollars} per user per month with ${formatCredits(MAX_CREDIT_TIER.credits)} credits a month and a weekly refresh of ${formatCredits(MAX_CREDIT_TIER.weeklyRefreshCredits)}. Annual billing costs ${ANNUAL_DISCOUNT_RATE * 100}% less for the same credits. Enterprise pricing is custom.`,
  },
  {
    question: 'What is a credit, and what does an agent run cost?',
    answer: `One credit is $${1 / CREDITS_PER_DOLLAR}, so $1 buys ${CREDITS_PER_DOLLAR} credits. Each workflow run has a base charge of 1 credit, plus model and tool usage on Sim-hosted keys and any sandbox runtime. Every run in Logs shows its exact cost.`,
  },
  {
    question: 'Can I use my own model API keys?',
    answer:
      'Yes. Add your provider keys under Settings → BYOK and Sim uses them instead of its hosted keys. You pay the provider directly for those calls, and Sim adds no usage charge for them. The 1-credit base run charge still applies, as do hosted tool and sandbox charges for anything that does not run on your keys.',
  },
  {
    question: 'Can I self-host Sim for free?',
    answer:
      'Yes. Sim is open source under the Apache 2.0 license and runs with Docker Compose or Kubernetes. Self-hosting has no Sim plan charge; you pay for your own infrastructure and model providers. Enterprise features such as SSO and access control need a license.',
  },
  {
    question: 'What does the Enterprise plan add?',
    answer:
      'Enterprise adds SSO, access control, enterprise features for self-hosted deployments, dedicated support, and custom credits, limits, and infrastructure. Contact sales for a quote.',
  },
] as const

const PRICING_FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/pricing#faq`,
  mainEntity: PRICING_FAQS.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
}

/** Pricing FAQ with matching `FAQPage` JSON-LD, so the structured answers always equal the visible ones. */
export function PricingFAQ() {
  return (
    <section
      id='faq'
      aria-labelledby='pricing-faq-heading'
      className='mx-auto w-full max-w-[720px] px-6 pt-4 pb-16'
    >
      <JsonLd data={PRICING_FAQ_JSON_LD} />
      <h2
        id='pricing-faq-heading'
        className='mb-8 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em]'
      >
        Frequently asked questions
      </h2>
      <LandingFAQ faqs={[...PRICING_FAQS]} />
    </section>
  )
}
