'use client'

import {
  useCreateMemorySpace,
  useMemorySpaces,
  useSelectMemorySpace,
} from '@/hooks/queries/memory-spaces'
import { toast } from '@/platform/lib/data/toast'

export const KNOWLEDGE_GRAPH_NAME_MAX_LENGTH = 100

export function useKnowledgeGraphs(organizationId: string) {
  const spaces = useMemorySpaces(organizationId)
  const select = useSelectMemorySpace(organizationId)
  const create = useCreateMemorySpace(organizationId)
  return {
    status: spaces.data ? 'success' : spaces.status,
    error: spaces.error?.message,
    retry: () => void spaces.refetch(),
    graphs: (spaces.data?.spaces ?? []).map((space) => ({
      id: space.id,
      key: space.id ?? 'default',
      name: space.name,
      description:
        space.id === null
          ? 'Your original knowledge graph, preserved.'
          : 'Private to you in this organization.',
      active: space.id === spaces.data?.activeSpaceId,
    })),
    selecting: select.isPending,
    makeActive: (spaceId: string | null) =>
      select.mutate({ spaceId }, { onError: (error) => toast.error(error.message) }),
    create: async (name: string) => {
      await create.mutateAsync({ name })
    },
  }
}
