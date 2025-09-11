import type { Metadata } from 'next'
import Landing from '@/app/(landing)/landing'

export const metadata: Metadata = {
  title: 'Sim - AI Agent Workflow Builder | Open Source Platform',
  description:
    'Open-source AI agent workflow builder used by 30,000+ developers. Build and deploy agentic workflows with visual drag-and-drop interface. Connect 100+ apps. SOC2 and HIPAA compliant. Used by startups to Fortune 500 companies.',
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
      'Open-source platform used by 30,000+ developers. Build and deploy agentic workflows with drag-and-drop interface. SOC2 & HIPAA compliant. Connect 100+ apps.',
    type: 'website',
    url: 'https://sim.ai',
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
      'Open-source platform for agentic workflows. 30,000+ developers. Visual builder. 100+ integrations. SOC2 & HIPAA compliant.',
    images: {
      url: '/social/twitter-image.png',
      alt: 'Sim - Visual AI Workflow Builder',
    },
  },
  alternates: {
    canonical: 'https://sim.ai',
    languages: {
      'en-US': 'https://sim.ai',
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
      'email automation, slack bots, discord moderation, data analysis, customer support, content generation',
    'llm:integrations':
      'OpenAI, Anthropic, Google AI, Slack, Gmail, Discord, Notion, Airtable, Supabase',
    'llm:pricing': 'free tier available, pro $20/month, team $40/month, enterprise custom',
  },
}

export default function Page() {
  return <Landing />
}
