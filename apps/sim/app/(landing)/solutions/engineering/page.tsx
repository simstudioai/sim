import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import EngineeringSolution from '@/app/(landing)/solutions/engineering/engineering'

export const revalidate = 3600

const PAGE_URL = `${SITE_URL}/solutions/engineering`
const TITLE = 'AI Agents for Code Review & On-Call | Sim'
const DESCRIPTION =
  'Engineering teams use Sim, the open-source AI workspace, to build and deploy AI agents that automate code review, on-call triage, and documentation.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords:
    'AI workspace, AI agents for engineering, automated code review, on-call automation, CI/CD agents, developer automation, open-source AI agent platform',
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
        alt: 'AI Agents for Code Review & On-Call | Sim',
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
  return <EngineeringSolution />
}
