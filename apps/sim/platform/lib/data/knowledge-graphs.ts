'use client'

import { MEMORY_SPACE_NAME_MAX_LENGTH } from '@/lib/api/contracts/memory-spaces'
import {
  useCreateMemorySpace,
  useMemorySpaces,
  useSelectMemorySpace,
} from '@/hooks/queries/memory-spaces'
import { toast } from '@/platform/lib/data/toast'
import { queryView } from '@/platform/shared/query-view'

export function useKnowledgeGraphs(organizationId: string) {
  const spaces = useMemorySpaces(organizationId)
  const select = useSelectMemorySpace(organizationId)
  const create = useCreateMemorySpace(organizationId)
  return {
    ...queryView(spaces),
    error: spaces.error?.message,
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
    nameMaxLength: MEMORY_SPACE_NAME_MAX_LENGTH,
    selecting: select.isPending,
    creating: create.isPending,
    makeActive: (spaceId: string | null) =>
      select.mutate({ spaceId }, { onError: (error) => toast.error(error.message) }),
    create: async (name: string) => {
      await create.mutateAsync({ name })
    },
  }
}
