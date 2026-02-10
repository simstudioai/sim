import type { Metadata } from 'next'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'

/**
 * SEO metadata for the landing page.
 *
 * - `title` contains the primary keyword and brand name.
 * - `description` is 150-160 chars, front-loaded with the value proposition.
 * - `openGraph` provides social sharing metadata with a dedicated OG image.
 * - `robots` ensures the landing page is fully indexable.
 * - `alternates.canonical` prevents duplicate content issues.
 *
 * GEO note: The description is written as a direct answer to "What is Sim?"
 * so LLMs can extract it as a cited definition.
 */
export const metadata: Metadata = {
  metadataBase: new URL('https://sim.ai'),
  title: 'Sim — Workflows for LLMs | Build AI Agent Workflows',
  description:
    'Sim is an open-source AI agent workflow builder. Build and deploy agentic workflows with a visual drag-and-drop interface. 100+ integrations. SOC2 and HIPAA compliant.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://sim.ai',
    siteName: 'Sim',
    title: 'Sim — Workflows for LLMs | Build AI Agent Workflows',
    description:
      'Open-source AI agent workflow builder used by 60,000+ developers. Visual drag-and-drop interface for building agentic workflows.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Sim — AI Agent Workflow Builder',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@simdotai',
    creator: '@simdotai',
    title: 'Sim — Workflows for LLMs',
    description:
      'Open-source AI agent workflow builder. Build and deploy agentic workflows with a visual drag-and-drop interface.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://sim.ai',
  },
  other: {
    'msapplication-TileColor': '#000000',
    'theme-color': '#ffffff',
  },
}

/**
 * Landing page layout.
 *
 * Applies landing-specific font CSS variables to the subtree:
 * - `--font-season` (Season Sans): Headings and display text
 * - `--font-martian-mono` (Martian Mono): Code snippets and technical accents
 *
 * These CSS variables are available to all child components via Tailwind classes
 * (`font-season`, `font-martian-mono`) or direct `var()` usage.
 *
 * The layout is a Server Component — no `'use client'` needed.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${season.variable} ${martianMono.variable}`}>{children}</div>
}
