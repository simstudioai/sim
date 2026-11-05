import { SolutionsPage } from '@/app/(landing)/components/solutions-page'
import type { SolutionsProductPageConfig } from '@/app/(landing)/components/solutions-page/types'
import { SearchPreview } from '@/app/(landing)/search/components/search-preview'

export const SEARCH_PAGE_DESCRIPTION =
  'Ask Sim questions and find company files, content, and context in one place. Sim Search is available with Sim Enterprise. Request a demo.'

const SEARCH_CONFIG: SolutionsProductPageConfig = {
  module: 'Search',
  path: '/search',
  seoDescription: SEARCH_PAGE_DESCRIPTION,
  offersFreeTier: false,
  hero: {
    eyebrow: 'Sim Search',
    heading: 'Your company’s knowledge. One place to ask.',
    description:
      'Ask Sim a question or search for the file you need. Bring your company’s content and context into the conversation, right inside your AI workspace. Available with Sim Enterprise.',
    summary:
      'Sim Search brings conversational AI and enterprise search into Sim, the AI workspace for teams. Ask questions in Chat, find company files and content, and use that context to keep working in the same conversation. Sim Search is an enterprise-only feature. Request a demo to explore it with your team.',
    visual: <SearchPreview layout='hero' />,
  },
  features: [
    {
      id: 'ask-sim',
      allowPreviewHover: true,
      title: 'Ask a question. Get to the context.',
      label: 'Company knowledge, in conversation',
      description:
        'Ask Sim about a project, a process, or a document. Follow up in the same conversation to explore the details that matter to your work.',
      visual: <SearchPreview layout='feature' />,
      visualSize: 'compact',
    },
    {
      id: 'find-content',
      fadePreviewRight: false,
      allowPreviewHover: true,
      title: 'Find the file. Pick up the thread.',
      label: 'Search company content',
      description:
        'Search for files and content by what you need to know. Sim Search gives your team one place to look for the information behind the work.',
      visual: <SearchPreview layout='feature' mode='files' />,
    },
    {
      id: 'use-context',
      allowPreviewHover: true,
      title: 'Keep the context in the conversation.',
      label: 'From search to Chat',
      description:
        'Bring the content you find into Chat. Ask Sim to explain a document, summarize the key points, or help you think through the next step.',
      visual: <SearchPreview layout='feature' mode='context' />,
    },
  ],
}

export default function Search() {
  return <SolutionsPage config={SEARCH_CONFIG} />
}
