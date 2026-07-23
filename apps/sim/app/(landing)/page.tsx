import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import {
  HOME_PAGE_DESCRIPTION,
  HOME_PAGE_TITLE,
} from '@/app/(landing)/components/home-structured-data'
import Landing from '@/app/(landing)/landing'

export const revalidate = 3600

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    absolute: HOME_PAGE_TITLE,
  },
  description: HOME_PAGE_DESCRIPTION,
  keywords:
    'AI workspace, AI agent builder, AI agent workflow builder, build AI agents, visual workflow builder, open-source AI agent platform, AI agents, agentic workflows, LLM orchestration, AI automation, knowledge base, workflow builder, AI integrations, SOC2 compliant, enterprise AI',
  authors: [{ name: 'Sim' }],
  creator: 'Sim',
  publisher: 'Sim',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: HOME_PAGE_TITLE,
    description: HOME_PAGE_DESCRIPTION,
    type: 'website',
    url: SITE_URL,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/reverse/small.png',
        width: 2130,
        height: 1200,
        alt: 'Sim, The AI Workspace for Teams',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: HOME_PAGE_TITLE,
    description: HOME_PAGE_DESCRIPTION,
    images: {
      url: '/logo/426-240/reverse/small.png',
      alt: 'Sim, The AI Workspace for Teams',
    },
  },
  alternates: {
    canonical: SITE_URL,
    languages: {
      'en-US': SITE_URL,
      'x-default': SITE_URL,
    },
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  category: 'technology',
  classification: 'AI Development Tools',
  referrer: 'origin-when-cross-origin',
}

export default function Page() {
  return <Landing />
}
