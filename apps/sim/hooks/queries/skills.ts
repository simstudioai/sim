import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getQueryClient } from '@/app/_shell/providers/query-provider'

const logger = createLogger('SkillsQueries')
const API_ENDPOINT = '/api/skills'

export interface SkillDefinition {
  id: string
  workspaceId: string | null
  userId: string | null
  name: string
  description: string
  content: string
  createdAt: string
  updatedAt?: string
}

/**
 * Query key factories for skills queries
 */
export const skillsKeys = {
  all: ['skills'] as const,
  lists: () => [...skillsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...skillsKeys.lists(), workspaceId] as const,
}

/**
 * Extract workspaceId from the current URL path
 */
function getWorkspaceIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/^\/workspace\/([^/]+)/)
  return match?.[1] ?? null
}

/**
 * Get all skills from the query cache (for non-React code)
 */
export function getSkills(workspaceId?: string): SkillDefinition[] {
  if (typeof window === 'undefined') return []
  const wsId = workspaceId ?? getWorkspaceIdFromUrl()
  if (!wsId) return []
  const queryClient = getQueryClient()
  return queryClient.getQueryData<SkillDefinition[]>(skillsKeys.list(wsId)) ?? []
}

/**
 * Get a specific skill from the query cache by ID or name
 */
export function getSkill(identifier: string, workspaceId?: string): SkillDefinition | undefined {
  const skills = getSkills(workspaceId)
  return skills.find((s) => s.id === identifier || s.name === identifier)
}

/**
 * Fetch skills for a workspace
 */
async function fetchSkills(workspaceId: string): Promise<SkillDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch skills: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  return data.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    workspaceId: (s.workspaceId as string) ?? null,
    userId: (s.userId as string) ?? null,
    name: s.name as string,
    description: s.description as string,
    content: s.content as string,
    createdAt: (s.createdAt as string) ?? new Date().toISOString(),
    updatedAt: s.updatedAt as string | undefined,
  }))
}

/**
 * Hook to fetch skills for a workspace
 */
export function useSkills(workspaceId: string) {
  return useQuery<SkillDefinition[]>({
    queryKey: skillsKeys.list(workspaceId),
    queryFn: () => fetchSkills(workspaceId),
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

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: [{ name: s.name, description: s.description, content: s.content }],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create skill')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing skills data')
      }

      logger.info(`Created skill: ${s.name}`)
      return data.data
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

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: [
            {
              id: skillId,
              name: updates.name ?? currentSkill.name,
              description: updates.description ?? currentSkill.description,
              content: updates.content ?? currentSkill.content,
            },
          ],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update skill')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing skills data')
      }

      logger.info(`Updated skill: ${skillId}`)
      return data.data
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

      const response = await fetch(`${API_ENDPOINT}?id=${skillId}&workspaceId=${workspaceId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete skill')
      }

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
