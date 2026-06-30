import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import FinanceSolution from '@/app/(landing)/solutions/finance/finance'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/solutions/finance`
const TITLE = 'AI Agents for Invoice Processing & Reconciliation | Sim'
const DESCRIPTION =
  'Finance teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate reconciliation, invoice processing, and reporting.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords:
    'AI workspace, AI agents for finance, finance automation, invoice processing, account reconciliation, financial reporting, open-source AI agent platform',
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
        alt: 'AI Agents for Invoice Processing & Reconciliation | Sim',
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
    images: { url: '/logo/426-240/reverse/small.png', alt: 'Sim' },
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
  return <FinanceSolution />
}
