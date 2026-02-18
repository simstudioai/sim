import type { Metadata } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'
import Landing from '@/app/(home)/landing'

export const dynamic = 'force-dynamic'

const baseUrl = getBaseUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Sim — Build AI Agents & Run Your Agentic Workforce',
  description:
    'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows.',
  keywords:
    'AI agents, agentic workforce, open-source AI agent platform, agentic workflows, LLM orchestration, AI automation, knowledge base, workflow builder, AI integrations, SOC2 compliant, HIPAA compliant, enterprise AI',
  authors: [{ name: 'Sim' }],
  creator: 'Sim',
  publisher: 'Sim',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Sim — Build AI Agents & Run Your Agentic Workforce',
    description:
      'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables, and docs. Join over 100,000 builders.',
    type: 'website',
    url: baseUrl,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/primary/small.png',
        width: 2130,
        height: 1200,
        alt: 'Sim — Build AI Agents & Run Your Agentic Workforce',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: 'Sim — Build AI Agents & Run Your Agentic Workforce',
    description:
      'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to orchestrate agentic workflows.',
    images: {
      url: '/logo/426-240/primary/small.png',
      alt: 'Sim — Build AI Agents & Run Your Agentic Workforce',
    },
  },
  alternates: {
    canonical: baseUrl,
    languages: {
      'en-US': baseUrl,
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
  other: {
    'llm:content-type':
      'AI agent platform, agentic workforce, agentic workflows, LLM orchestration',
    'llm:use-cases':
      'AI agents, agentic workforce, agentic workflows, knowledge bases, tables, document creation, email automation, Slack bots, data analysis, customer support, content generation',
    'llm:integrations':
      'OpenAI, Anthropic, Google AI, Mistral, xAI, Perplexity, Slack, Gmail, Discord, Notion, Airtable, Supabase',
    'llm:pricing': 'free tier available, pro $20/month, team $40/month, enterprise custom',
    'llm:region': 'global',
    'llm:languages': 'en',
  },
}

export default function Page() {
  return <Landing />
}
