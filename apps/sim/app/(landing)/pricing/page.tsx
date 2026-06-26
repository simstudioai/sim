import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import Pricing from '@/app/(landing)/pricing/pricing'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/pricing`
const TITLE = 'Pricing — Sim, the AI Workspace'
const DESCRIPTION =
  'Pricing for Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Compare the Free, Pro, Max, and Enterprise plans — each connecting 1,000+ integrations and every major LLM. Start free and upgrade as your team scales.'

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
        alt: 'Pricing — Sim, the AI Workspace',
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
      alt: 'Pricing — Sim, the AI Workspace',
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

export default function Page() {
  return <Pricing />
}
