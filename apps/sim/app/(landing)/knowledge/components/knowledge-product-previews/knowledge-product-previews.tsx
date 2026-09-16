'use client'

import { PackageSearchIcon } from '@/components/icons'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { KnowledgeDocumentDetail } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/components/knowledge-document-detail'
import { KNOWLEDGE_PREVIEW_SOURCES } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/data'

const SEARCH_BLOCK: BlockDef = {
  id: 'knowledge-search',
  type: 'knowledge',
  typeLabel: 'Knowledge',
  name: 'Search knowledge',
  icon: PackageSearchIcon,
  bgColor: '#00B0B0',
  sentence: {
    segments: ['Search ', { subBlockId: 'knowledgeBaseSelector' }],
    values: { knowledgeBaseSelector: 'Product knowledge' },
  },
  rows: [],
  x: 0,
  y: 0,
}

/** The real document's Content, Index, Tokens, and Status table replaces the invented inspector. */
export function KnowledgeDocumentsPreview() {
  return (
    <div className='absolute top-16 bottom-[-40px] left-[12%] flex w-[76%] min-w-[440px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] font-normal text-[13px] text-[var(--text-body)] shadow-xs'>
      <KnowledgeDocumentDetail document={KNOWLEDGE_PREVIEW_SOURCES[0].documents[0]} />
    </div>
  )
}

/** KnowledgeBlock's Search sentence, rendered by the same native workflow card used in the hero. */
export function KnowledgeRetrievalPreview() {
  return (
    <div className='absolute inset-0'>
      <div className='absolute top-[172px] right-0 left-0 h-px bg-[var(--border)]' />
      <div className='-translate-x-1/2 absolute top-[116px] left-1/2 h-[112px] w-[250px]'>
        <StageBlockCard block={SEARCH_BLOCK} orientation='horizontal' decorative />
      </div>
    </div>
  )
}
