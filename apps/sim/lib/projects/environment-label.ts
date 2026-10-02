import type { ProjectApi } from '@/lib/api/contracts/projects'

/** Qualify environment names that repeat across projects without losing historical names. */
export function projectEnvironmentLabel(
  projects: ProjectApi[] | undefined,
  workspaceId: string,
  fallback: string
): string {
  const project = projects?.find((entry) =>
    entry.workspaces.some((environment) => environment.id === workspaceId)
  )
  const environment = project?.workspaces.find((entry) => entry.id === workspaceId)
  return project && environment ? `${project.name} / ${environment.name}` : fallback
}
