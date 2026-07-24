export const workflowAnnotationKeys = {
  all: ['workflow-annotations'] as const,
  lists: () => [...workflowAnnotationKeys.all, 'list'] as const,
  list: (workflowId: string | undefined) =>
    [...workflowAnnotationKeys.lists(), workflowId ?? ''] as const,
}
