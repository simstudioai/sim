import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import {
  KnowledgeDocumentsPreview,
  KnowledgeRetrievalPreview,
  KnowledgeSourcesPreview,
} from '@/app/(landing)/knowledge/components/knowledge-product-previews'

export const KNOWLEDGE_PAGE_DESCRIPTION =
  'Give AI agents trusted company knowledge in Sim. Connect sources, manage indexed documents, and retrieve relevant passages with source references in your workflows.'

const KNOWLEDGE_CONFIG: SolutionsProductPageConfig = {
  module: 'Knowledge Base',
  path: '/knowledge',
  seoDescription: KNOWLEDGE_PAGE_DESCRIPTION,
  hero: {
    visual: <ProductHeroPreview product='knowledge' />,
    eyebrow: 'Knowledge Base',
    heading: 'Trusted knowledge for your AI agents.',
    description:
      'Connect your sources. Give AI agents trusted company knowledge to work with in Sim.',
    summary:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Knowledge Base brings uploaded documents and connected sources into searchable collections. Teams can inspect indexed passages, manage source syncs, and retrieve relevant information with source metadata from their workflows.',
  },
  codeExample: {
    title: 'Search knowledge from your terminal.',
    description:
      'Ask the Sim CLI for relevant passages from a knowledge base and bring that context into your own tools.',
    filename: 'knowledge.sh',
    commands: [
      'sim knowledge list',
      'sim knowledge search \\',
      '  --kb "$KNOWLEDGE_BASE_ID" \\',
      '  --query "refund policy"',
    ],
  },
  features: [
    {
      id: 'connect-sources',
      label: 'Connect sources',
      title: 'Connected sources. Shared context.',
      description:
        'Bring documents from Notion, Drive, and your other sources into one searchable knowledge base.',
      visual: <KnowledgeSourcesPreview />,
      cta: {
        label: 'Explore knowledge connectors',
        href: 'https://docs.sim.ai/knowledgebase/connectors',
      },
    },
    {
      id: 'manage-documents',
      label: 'Manage documents',
      title: 'See what’s indexed.',
      description: 'Review indexed passages and see which chunks are enabled for search.',
      visual: <KnowledgeDocumentsPreview />,
    },
    {
      id: 'retrieve-context',
      label: 'Retrieve context',
      title: 'Give agents the right context.',
      description:
        'Search from a workflow and pass relevant passages, with source references, to the next step.',
      visual: <KnowledgeRetrievalPreview />,
      cta: {
        label: 'Read the Knowledge block guide',
        href: 'https://docs.sim.ai/integrations/knowledge',
      },
    },
  ],
}

export default function Knowledge() {
  return <SolutionsPage config={KNOWLEDGE_CONFIG} />
}
