import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

export function compareByOrder<T extends { sortOrder: number; createdAt?: Date; id: string }>(
  a: T,
  b: T
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const timeA = a.createdAt?.getTime() ?? 0
  const timeB = b.createdAt?.getTime() ?? 0
  if (timeA !== timeB) return timeA - timeB
  return a.id.localeCompare(b.id)
}

export function groupWorkflowsByFolder(
  workflows: WorkflowMetadata[]
): Record<string, WorkflowMetadata[]> {
  const grouped = workflows.reduce(
    (acc, workflow) => {
      const folderId = workflow.folderId || 'root'
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(workflow)
      return acc
    },
    {} as Record<string, WorkflowMetadata[]>
  )
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(compareByOrder)
  }
  return grouped
}
