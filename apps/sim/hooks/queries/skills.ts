import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteSkillContract,
  listSkillMembersContract,
  listSkillsContract,
  removeSkillMemberContract,
  type Skill,
  type SkillEditor,
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
  memberLists: () => [...skillsKeys.all, 'members'] as const,
  members: (skillId?: string) => [...skillsKeys.memberLists(), skillId ?? ''] as const,
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
            },
          ],
          workspaceId,
        },
      })

      logger.info(`Created skill: ${s.name}`)
      // The upsert responds with the caller's whole skill list (built-ins
      // included), not just the new row. Resolve the created row here — by name,
      // which is unique per workspace and which a same-named built-in is filtered
      // out of — so consumers get an id instead of re-deriving one.
      return { skills: data, created: data.find((skill) => skill.name === s.name) ?? null }
    },
    onSuccess: ({ skills }, variables) => {
      // The response is the same authoritative list GET /api/skills returns for
      // this caller, so seed the cache with it verbatim. Merging by id would keep
      // the previous ordering and append the new skill at the bottom until the
      // refetch lands.
      queryClient.setQueryData<SkillDefinition[]>(skillsKeys.list(variables.workspaceId), skills)
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
      // Only name/description/content go over the wire here, none of which can
      // change the editor roster — no need to invalidate it.
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
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
 * Fetch the editor roster for a skill (explicit editors plus derived workspace
 * admins). Built-in skills have no editors — callers should not enable this
 * for readOnly skills.
 */
export function useSkillMembers(skillId?: string, options?: { enabled?: boolean }) {
  return useQuery<SkillEditor[]>({
    queryKey: skillsKeys.members(skillId),
    queryFn: async ({ signal }) => {
      if (!skillId) return []
      const data = await requestJson(listSkillMembersContract, {
        params: { id: skillId },
        signal,
      })
      return data.editors
    },
    enabled: Boolean(skillId) && (options?.enabled ?? true),
    staleTime: SKILL_MEMBER_LIST_STALE_TIME,
  })
}

interface UpsertSkillMemberParams {
  skillId: string
  workspaceId: string
  userId: string
}

export function useUpsertSkillMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ skillId, userId }: UpsertSkillMemberParams) => {
      return requestJson(upsertSkillMemberContract, {
        params: { id: skillId },
        body: { userId },
      })
    },
    onSuccess: (_data, variables) => {
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
      const previousEditors = queryClient.getQueryData<SkillEditor[]>(
        skillsKeys.members(variables.skillId)
      )
      if (previousEditors) {
        queryClient.setQueryData<SkillEditor[]>(
          skillsKeys.members(variables.skillId),
          previousEditors.filter((editor) => editor.userId !== variables.userId)
        )
      }
      return { previousEditors }
    },
    onError: (_err, variables, context) => {
      if (context?.previousEditors) {
        queryClient.setQueryData(skillsKeys.members(variables.skillId), context.previousEditors)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.members(variables.skillId) })
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}
