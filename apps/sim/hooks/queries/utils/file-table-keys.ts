export const workspaceFileTableKeys = {
  all: ['workspaceFileTable'] as const,
  projectPreviews: (projectId: string) =>
    [...workspaceFileTableKeys.all, 'project-preview', projectId] as const,
  projectPreview: (projectId: string, fileId: string, key: string, version?: number) =>
    [...workspaceFileTableKeys.projectPreviews(projectId), fileId, key, version ?? ''] as const,
  previews: () => [...workspaceFileTableKeys.all, 'preview'] as const,
  preview: (workspaceId: string, fileId: string, key: string, version?: number) =>
    [...workspaceFileTableKeys.previews(), workspaceId, fileId, key, version ?? ''] as const,
}
