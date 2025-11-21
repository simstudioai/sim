import type { Metadata } from 'next'
import { getBaseUrl } from '@/lib/urls/utils'
import Landing from '@/app/(landing)/landing'

const baseUrl = getBaseUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Sim - AI Agent Workflow Builder | Open Source Platform',
  description:
    'Open-source AI agent workflow builder used by 50,000+ developers. Build and deploy agentic workflows with a visual drag-and-drop canvas. Connect 100+ apps and ship SOC2 & HIPAA-ready AI automations from startups to Fortune 500.',
  keywords:
    'AI agent workflow builder, agentic workflows, open source AI, visual workflow builder, AI automation, LLM workflows, AI agents, workflow automation, no-code AI, SOC2 compliant, HIPAA compliant, enterprise AI',
  authors: [{ name: 'Sim Studio' }],
  creator: 'Sim Studio',
  publisher: 'Sim Studio',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: 'Sim - AI Agent Workflow Builder | Open Source',
    description:
      'Open-source platform used by 50,000+ developers. Design, deploy, and monitor agentic workflows with a visual drag-and-drop interface, 100+ integrations, and enterprise-grade security.',
    type: 'website',
    url: baseUrl,
    siteName: 'Sim',
    locale: 'en_US',
    images: [
      {
        url: '/social/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Sim - Visual AI Workflow Builder',
        type: 'image/png',
      },
      {
        url: '/social/og-image-square.png',
        width: 600,
        height: 600,
        alt: 'Sim Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: 'Sim - AI Agent Workflow Builder | Open Source',
    description:
      'Open-source platform for agentic workflows. 50,000+ developers. Visual builder. 100+ integrations. SOC2 & HIPAA compliant.',
    images: {
      url: '/social/twitter-image.png',
      alt: 'Sim - Visual AI Workflow Builder',
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
  // LLM SEO optimizations
  other: {
    'llm:content-type': 'AI workflow builder, visual programming, no-code AI development',
    'llm:use-cases':
      'email automation, Slack bots, Discord moderation, data analysis, customer support, content generation, agentic automations',
    'llm:integrations':
      'OpenAI, Anthropic, Google AI, Slack, Gmail, Discord, Notion, Airtable, Supabase',
    'llm:pricing': 'free tier available, pro $20/month, team $40/month, enterprise custom',
    'llm:region': 'global',
    'llm:languages': 'en',
  },
}

export default function Page() {
  return <Landing />
}
