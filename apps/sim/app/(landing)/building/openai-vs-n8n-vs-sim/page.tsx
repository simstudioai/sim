import type { Metadata } from 'next'
import OpenAiN8nSim from './openai-n8n-sim'

export const metadata: Metadata = {
  title: 'Building with n8n vs Sim: A Comparison | Sim',
  description:
    'Explore the key differences between n8n and Sim for building AI agent workflows and understand which platform best fits your needs.',
  openGraph: {
    title: 'Building with n8n vs Sim: A Comparison',
    description:
      'Explore the key differences between n8n and Sim for building AI agent workflows and understand which platform best fits your needs.',
    type: 'article',
    publishedTime: '2025-10-06',
  },
}

/**
 * Blog post page comparing n8n and Sim
 */
export default function Page() {
  return <OpenAiN8nSim />
}
