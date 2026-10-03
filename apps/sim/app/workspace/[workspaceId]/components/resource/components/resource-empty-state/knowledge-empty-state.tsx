import { Chip } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { EmptyState, type EmptyStateProps } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
import { KnowledgeIsoMark } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/knowledge-iso'

const KNOWLEDGE_DOCS_URL = 'https://docs.sim.ai/knowledgebase'

interface CreateKnowledgeEmptyStateProps {
  /** Opens the create-base modal — the same action the header's primary chip runs. */
  onCreate: () => void
  /** Mirrors the header chip's disabled state: no edit rights on the workspace. */
  createDisabled?: boolean
}

type KnowledgeEmptyStateProps = CreateKnowledgeEmptyStateProps | Omit<EmptyStateProps, 'graphic'>

/** Shared knowledge illustration and actions for empty or unavailable bases. */
export function KnowledgeEmptyState(props: KnowledgeEmptyStateProps) {
  const content = 'title' in props ? props : undefined
  return (
    <EmptyState
      graphic={<KnowledgeIsoMark />}
      title={content?.title ?? 'Knowledge bases'}
      description={
        content?.description ?? 'Upload documents to give your agents a memory they can search.'
      }
      action={
        <>
          {'onCreate' in props ? (
            <Chip
              variant='primary'
              onClick={props.onCreate}
              disabled={props.createDisabled}
              leftIcon={Plus}
            >
              New base
            </Chip>
          ) : (
            content?.action
          )}
          <EmptyStateDocsLink href={KNOWLEDGE_DOCS_URL} />
        </>
      }
    />
  )
}
