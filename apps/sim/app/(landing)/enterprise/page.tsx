import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import EnterprisePage from '@/app/(landing)/enterprise/enterprise'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/enterprise`
const TITLE = 'Enterprise AI Agent Platform | Sim AI'
const DESCRIPTION =
  'Build, deploy, and govern enterprise AI agents in one workspace with security, approvals, observability, and collaboration.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords:
    'enterprise ai agents, enterprise ai agent, enterprise ai agent platform, enterprise workflow agents',
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
        alt: TITLE,
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
  return <EnterprisePage />
}
