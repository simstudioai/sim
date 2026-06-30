import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import Demo from '@/app/(landing)/demo/demo'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/demo`
const TITLE = 'Book a Demo | Sim, the AI Workspace'
const DESCRIPTION =
  'Book a demo of Sim, the AI agent workspace where teams build, deploy, and manage AI agents and workflows that connect 1,000+ integrations and every major LLM.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
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
        alt: 'Book a Demo | Sim, the AI Workspace',
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
      alt: 'Book a Demo | Sim, the AI Workspace',
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
  return <Demo />
}
