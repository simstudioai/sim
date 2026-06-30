import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { SITE_URL } from '@/lib/core/utils/urls'
import Pricing from '@/app/(landing)/pricing/pricing'
import { pricingSearchParamsCache } from '@/app/(landing)/pricing/search-params'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/pricing`
const TITLE = 'Pricing | Sim, the AI Workspace'
const DESCRIPTION =
  'Pricing for Sim, the open-source AI workspace for building, deploying, and managing AI agents. Compare the Free, Pro, Max, and Enterprise plans. Start free.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords:
    'Sim pricing, AI workspace pricing, AI agent platform pricing, build AI agents, Pro plan, Max plan, Enterprise plan, open-source AI agents, LLM pricing',
  authors: [{ name: 'Sim' }],
  creator: 'Sim',
  publisher: 'Sim',
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: PAGE_URL,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/reverse/small.png',
        width: 2130,
        height: 1200,
        alt: 'Pricing | Sim, the AI Workspace',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: TITLE,
    description: DESCRIPTION,
    images: {
      url: '/logo/426-240/reverse/small.png',
      alt: 'Pricing | Sim, the AI Workspace',
    },
  },
  alternates: {
    canonical: PAGE_URL,
    languages: { 'en-US': PAGE_URL, 'x-default': PAGE_URL },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  category: 'technology',
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Parse on the server so the route renders dynamically with the billing period
  // from the URL — the client toggle (`useQueryStates`) then hydrates in sync.
  await pricingSearchParamsCache.parse(searchParams)
  return <Pricing />
}
