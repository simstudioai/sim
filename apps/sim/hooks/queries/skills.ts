import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteSkillContract,
  listSkillMembersContract,
  listSkillsContract,
  removeSkillMemberContract,
  type Skill,
  type SkillMember,
  type SkillRole,
  upsertSkillMemberContract,
  upsertSkillsContract,
} from '@/lib/api/contracts'

const logger = createLogger('SkillsQueries')

export const SKILL_LIST_STALE_TIME = 60 * 1000
export const SKILL_MEMBER_LIST_STALE_TIME = 30 * 1000

export type SkillDefinition = Skill

/**
 * Query key factories for skills queries
 */
export const skillsKeys = {
  all: ['skills'] as const,
  lists: () => [...skillsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...skillsKeys.lists(), workspaceId] as const,
  members: (skillId?: string) => [...skillsKeys.all, 'members', skillId ?? ''] as const,
}

/**
 * Fetch skills for a workspace
 */
async function fetchSkills(workspaceId: string, signal?: AbortSignal): Promise<SkillDefinition[]> {
  const { data } = await requestJson(listSkillsContract, {
    query: { workspaceId },
    signal,
  })
  return data
}

/**
 * Hook to fetch skills for a workspace
 */
export function useSkills(workspaceId: string) {
  return useQuery<SkillDefinition[]>({
    queryKey: skillsKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchSkills(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: SKILL_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create skill mutation. On success the created skill is merged into the list
 * cache so consumers (e.g. the integration detail page's "Added" state) reflect
 * it immediately, before the invalidation refetch lands.
 */
interface CreateSkillParams {
  workspaceId: string
  skill: {
    name: string
    description: string
    content: string
    workspaceShared?: boolean
  }
}

export function useCreateSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skill: s }: CreateSkillParams) => {
      logger.info(`Creating skill: ${s.name} in workspace ${workspaceId}`)

      const { data } = await requestJson(upsertSkillsContract, {
        body: {
          skills: [
            {
              name: s.name,
              description: s.description,
              content: s.content,
              workspaceShared: s.workspaceShared,
            },
          ],
          workspaceId,
        },
      })

      logger.info(`Created skill: ${s.name}`)
      return data
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData<SkillDefinition[]>(
        skillsKeys.list(variables.workspaceId),
        (prev) => {
          const byId = new Map((prev ?? []).map((skill) => [skill.id, skill]))
          for (const skill of data) byId.set(skill.id, skill)
          return Array.from(byId.values())
        }
      )
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

/**
 * Update skill mutation
 */
interface UpdateSkillParams {
  workspaceId: string
  skillId: string
  updates: {
    name?: string
    description?: string
    content?: string
    workspaceShared?: boolean
  }
}

export function useUpdateSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skillId, updates }: UpdateSkillParams) => {
      logger.info(`Updating skill: ${skillId} in workspace ${workspaceId}`)

      // Updates are partial on the wire — omitted fields are preserved
      // server-side, so nothing is re-sent from a possibly-stale cache.
      const { data } = await requestJson(upsertSkillsContract, {
        body: {
          skills: [{ id: skillId, ...updates }],
          workspaceId,
        },
      })

      logger.info(`Updated skill: ${skillId}`)
      return data
    },
    onMutate: async ({ workspaceId, skillId, updates }) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.list(workspaceId) })

      const previousSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )

      if (previousSkills) {
        queryClient.setQueryData<SkillDefinition[]>(
          skillsKeys.list(workspaceId),
          previousSkills.map((s) =>
            s.id === skillId
              ? {
                  ...s,
                  name: updates.name ?? s.name,
                  description: updates.description ?? s.description,
                  content: updates.content ?? s.content,
                  workspaceShared: updates.workspaceShared ?? s.workspaceShared,
                }
              : s
          )
        )
      }

      return { previousSkills }
    },
    onError: (_err, variables, context) => {
      if (context?.previousSkills) {
        queryClient.setQueryData(skillsKeys.list(variables.workspaceId), context.previousSkills)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
      // The members roster derives implicit members from workspaceShared, so a
      // sharing toggle must refetch it too.
      queryClient.invalidateQueries({ queryKey: skillsKeys.members(variables.skillId) })
    },
  })
}

/**
 * Delete skill mutation
 */
interface DeleteSkillParams {
  workspaceId: string
  skillId: string
}

export function useDeleteSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skillId }: DeleteSkillParams) => {
      logger.info(`Deleting skill: ${skillId}`)

      const data = await requestJson(deleteSkillContract, {
        query: { id: skillId, workspaceId },
      })

      logger.info(`Deleted skill: ${skillId}`)
      return data
    },
    onMutate: async ({ workspaceId, skillId }) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.list(workspaceId) })

      const previousSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )

      if (previousSkills) {
        queryClient.setQueryData<SkillDefinition[]>(
          skillsKeys.list(workspaceId),
          previousSkills.filter((s) => s.id !== skillId)
        )
      }

      return { previousSkills }
    },
    onError: (_err, variables, context) => {
      if (context?.previousSkills) {
        queryClient.setQueryData(skillsKeys.list(variables.workspaceId), context.previousSkills)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

/**
 * Fetch the member list for a skill (explicit members, derived workspace
 * admins, and implicit workspace-shared members). Built-in skills have no
 * members — callers should not enable this for readOnly skills.
 */
export function useSkillMembers(skillId?: string, options?: { enabled?: boolean }) {
  return useQuery<SkillMember[]>({
    queryKey: skillsKeys.members(skillId),
    queryFn: async ({ signal }) => {
      if (!skillId) return []
      const data = await requestJson(listSkillMembersContract, {
        params: { id: skillId },
        signal,
      })
      return data.members
    },
    enabled: Boolean(skillId) && (options?.enabled ?? true),
    staleTime: SKILL_MEMBER_LIST_STALE_TIME,
  })
}

interface UpsertSkillMemberParams {
  skillId: string
  workspaceId: string
  userId: string
  role: SkillRole
}

export function useUpsertSkillMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ skillId, userId, role }: UpsertSkillMemberParams) => {
      return requestJson(upsertSkillMemberContract, {
        params: { id: skillId },
        body: { userId, role },
      })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.members(variables.skillId) })
      const previousMembers = queryClient.getQueryData<SkillMember[]>(
        skillsKeys.members(variables.skillId)
      )
      if (previousMembers) {
        queryClient.setQueryData<SkillMember[]>(
          skillsKeys.members(variables.skillId),
          previousMembers.map((member) =>
            member.userId === variables.userId && member.roleSource !== 'workspace-admin'
              ? {
                  ...member,
                  role: variables.role,
                  status: 'active',
                  roleSource: 'explicit',
                }
              : member
          )
        )
      }
      return { previousMembers }
    },
    onError: (_err, variables, context) => {
      if (context?.previousMembers) {
        queryClient.setQueryData(skillsKeys.members(variables.skillId), context.previousMembers)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.members(variables.skillId) })
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

interface RemoveSkillMemberParams {
  skillId: string
  workspaceId: string
  userId: string
}

export function useRemoveSkillMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ skillId, userId }: RemoveSkillMemberParams) => {
      return requestJson(removeSkillMemberContract, {
        params: { id: skillId },
        query: { userId },
      })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.members(variables.skillId) })
      const previousMembers = queryClient.getQueryData<SkillMember[]>(
        skillsKeys.members(variables.skillId)
      )
      if (previousMembers) {
        // Removal writes a deny marker server-side; mirror it so the row moves
        // to the removed state immediately instead of lingering clickable.
        queryClient.setQueryData<SkillMember[]>(
          skillsKeys.members(variables.skillId),
          previousMembers.map((member) =>
            member.userId === variables.userId && member.roleSource !== 'workspace-admin'
              ? { ...member, status: 'revoked', roleSource: 'explicit' }
              : member
          )
        )
      }
      return { previousMembers }
    },
    onError: (_err, variables, context) => {
      if (context?.previousMembers) {
        queryClient.setQueryData(skillsKeys.members(variables.skillId), context.previousMembers)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.members(variables.skillId) })
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}
