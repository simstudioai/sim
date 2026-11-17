import { z } from 'zod'
import { encodeGitLabResourceId, normalizeGitLabHost } from '@/tools/gitlab/utils'

export const GITLAB_GROUP_MAX_PROJECTS = 1000

export const gitLabGroupScopeSchema = z.object({
  host: z.string().min(1),
  group: z.object({
    id: z.number().int().positive(),
    path: z.string().min(1),
    includeSubgroups: z.boolean(),
  }),
  projects: z
    .array(z.object({ id: z.number().int().positive(), path: z.string().min(1) }))
    .min(1)
    .max(GITLAB_GROUP_MAX_PROJECTS),
})

export type GitLabGroupScope = z.output<typeof gitLabGroupScopeSchema>

/** Namespace boundaries exclude shared projects and similarly named sibling groups. */
export function gitLabProjectInGroup(path: string, group: GitLabGroupScope['group']): boolean {
  const namespace = path.slice(0, path.lastIndexOf('/'))
  return (
    namespace === group.path || (group.includeSubgroups && namespace.startsWith(`${group.path}/`))
  )
}

/** Bind saved permissions to the same canonical scope on every validation and live request. */
export function gitLabGroupMatchesConfig(
  scope: GitLabGroupScope,
  config: Record<string, unknown>
): boolean {
  try {
    return (
      config.scope === 'group' &&
      typeof config.group === 'string' &&
      (config.project === undefined || config.project === '') &&
      [undefined, '', 'true', 'false'].includes(config.includeSubgroups as string | undefined) &&
      scope.host === normalizeGitLabHost(config.host) &&
      [String(scope.group.id), encodeGitLabResourceId(scope.group.path)].includes(
        encodeGitLabResourceId(config.group)
      ) &&
      scope.group.includeSubgroups === (config.includeSubgroups === 'true')
    )
  } catch {
    return false
  }
}
