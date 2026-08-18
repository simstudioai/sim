import { Chip, ChipLink, Plus } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { KnowledgeIsoMark } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/knowledge-iso'

const KNOWLEDGE_DOCS_URL = 'https://docs.sim.ai/knowledgebase'

interface KnowledgeEmptyStateProps {
  /** Opens the create-base modal — the same action the header's primary chip runs. */
  onCreate: () => void
  /** Mirrors the header chip's disabled state: no edit rights on the workspace. */
  createDisabled?: boolean
}

/** Empty state for the knowledge bases list when the workspace has none. */
export function KnowledgeEmptyState({
  onCreate,
  createDisabled = false,
}: KnowledgeEmptyStateProps) {
  return (
    <EmptyState
      graphic={<KnowledgeIsoMark height={148} />}
      title='Knowledge bases'
      description='Upload documents to give your agents a memory they can search.'
      action={
        <div className='flex items-center gap-2'>
          <Chip variant='primary' onClick={onCreate} disabled={createDisabled} leftIcon={Plus}>
            New base
          </Chip>
          <ChipLink
            href={KNOWLEDGE_DOCS_URL}
            target='_blank'
            rel='noopener noreferrer'
            variant='border'
            leftIcon={BookOpen}
          >
            Docs
          </ChipLink>
        </div>
      }
    />
  )
}
