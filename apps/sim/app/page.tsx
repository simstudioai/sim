import type { Metadata } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'
import Landing from '@/app/(landing)/landing'

export const revalidate = 3600

const baseUrl = getBaseUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    absolute: 'Sim — The AI Workspace | Build, Deploy & Manage AI Agents',
  },
  description:
    'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work — visually, conversationally, or with code.',
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
    title: 'Sim — The AI Workspace | Build, Deploy & Manage AI Agents',
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work — visually, conversationally, or with code.',
    type: 'website',
    url: baseUrl,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/logo/426-240/primary/small.png',
        width: 2130,
        height: 1200,
        alt: 'Sim — The AI Workspace for Teams',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: 'Sim — The AI Workspace | Build, Deploy & Manage AI Agents',
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work.',
    images: {
      url: '/logo/426-240/primary/small.png',
      alt: 'Sim — The AI Workspace for Teams',
    },
  },
  alternates: {
    canonical: baseUrl,
    languages: {
      'en-US': baseUrl,
      'x-default': baseUrl,
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
      'AI workspace, AI agent builder, AI agent platform, agentic workflows, LLM orchestration',
    'llm:use-cases':
      'build AI agents, AI workspace, visual workflow builder, natural language agent creation, knowledge bases, tables, document creation, email automation, Slack bots, data analysis, customer support, content generation',
    'llm:integrations':
      'OpenAI, Anthropic, Google AI, Mistral, xAI, Perplexity, Slack, Gmail, Discord, Notion, Airtable, Supabase',
    'llm:pricing':
      'free tier available, pro $25/month, max $100/month, team plans available, enterprise custom',
    'llm:region': 'global',
    'llm:languages': 'en',
  },
}

export default function Page() {
  return <Landing />
}
