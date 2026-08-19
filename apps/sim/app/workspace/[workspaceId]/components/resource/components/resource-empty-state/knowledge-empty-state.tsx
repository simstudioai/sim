import { Chip } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
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
      graphic={<KnowledgeIsoMark />}
      title='Knowledge bases'
      description='Upload documents to give your agents a memory they can search.'
      action={
        <>
          <Chip variant='primary' onClick={onCreate} disabled={createDisabled} leftIcon={Plus}>
            New base
          </Chip>
          <EmptyStateDocsLink href={KNOWLEDGE_DOCS_URL} />
        </>
      }
    />
  )
}
