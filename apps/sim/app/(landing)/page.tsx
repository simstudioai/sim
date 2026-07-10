import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import Landing from '@/app/(landing)/landing'

export const revalidate = 3600

const SOCIAL_IMAGE = {
  url: '/brand/social/sim-og-image.png',
  width: 1200,
  height: 630,
  alt: 'Sim, The AI Workspace for Teams',
  type: 'image/png',
} as const

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    absolute: 'Sim, The AI Workspace | Build, Deploy & Manage AI Agents',
  },
  description:
    'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents across 1,000+ integrations and every major LLM.',
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
    title: 'Sim, The AI Workspace | Build, Deploy & Manage AI Agents',
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work, visually, conversationally, or with code.',
    type: 'website',
    url: SITE_URL,
    siteName: 'Sim',
    locale: 'en_US',
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: 'Sim, The AI Workspace | Build, Deploy & Manage AI Agents',
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work.',
    images: {
      url: SOCIAL_IMAGE.url,
      alt: SOCIAL_IMAGE.alt,
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
