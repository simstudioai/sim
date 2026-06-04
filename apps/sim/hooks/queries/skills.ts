import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteSkillContract,
  listSkillsContract,
  type Skill,
  upsertSkillsContract,
} from '@/lib/api/contracts'

const logger = createLogger('SkillsQueries')

export type SkillDefinition = Skill

/**
 * Query key factories for skills queries
 */
export const skillsKeys = {
  all: ['skills'] as const,
  lists: () => [...skillsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...skillsKeys.lists(), workspaceId] as const,
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
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create skill mutation
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
          skills: [{ name: s.name, description: s.description, content: s.content }],
          workspaceId,
        },
      })

      logger.info(`Created skill: ${s.name}`)
      return data
    },
    onSuccess: (_data, variables) => {
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

      const currentSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )
      const currentSkill = currentSkills?.find((s) => s.id === skillId)

      if (!currentSkill) {
        throw new Error('Skill not found')
      }

      const { data } = await requestJson(upsertSkillsContract, {
        body: {
          skills: [
            {
              id: skillId,
              name: updates.name ?? currentSkill.name,
              description: updates.description ?? currentSkill.description,
              content: updates.content ?? currentSkill.content,
            },
          ],
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
