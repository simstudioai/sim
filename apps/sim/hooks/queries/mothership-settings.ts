import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getMothershipSettingsContract,
  type MothershipSettings,
  updateMothershipSettingsContract,
} from '@/lib/api/contracts/mothership-settings'

export const mothershipSettingsKeys = {
  all: ['mothership-settings'] as const,
  detail: (workspaceId: string) => [...mothershipSettingsKeys.all, workspaceId] as const,
}

async function fetchMothershipSettings(
  workspaceId: string,
  signal?: AbortSignal
): Promise<MothershipSettings> {
  const { data } = await requestJson(getMothershipSettingsContract, {
    query: { workspaceId },
    signal,
  })
  return data
}

export function useMothershipSettings(workspaceId: string) {
  return useQuery({
    queryKey: mothershipSettingsKeys.detail(workspaceId),
    queryFn: ({ signal }) => fetchMothershipSettings(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

export function useUpdateMothershipSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: MothershipSettings) => {
      const { data } = await requestJson(updateMothershipSettingsContract, {
        body: {
          workspaceId: settings.workspaceId,
          mcpTools: settings.mcpTools,
          customTools: settings.customTools,
          skills: settings.skills,
        },
      })
      return data
    },
    onMutate: async (settings) => {
      await queryClient.cancelQueries({
        queryKey: mothershipSettingsKeys.detail(settings.workspaceId),
      })

      const previous = queryClient.getQueryData<MothershipSettings>(
        mothershipSettingsKeys.detail(settings.workspaceId)
      )

      queryClient.setQueryData(mothershipSettingsKeys.detail(settings.workspaceId), settings)
      return { previous }
    },
    onError: (_error, settings, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          mothershipSettingsKeys.detail(settings.workspaceId),
          context.previous
        )
      }
    },
    onSettled: (_data, _error, settings) => {
      queryClient.invalidateQueries({
        queryKey: mothershipSettingsKeys.detail(settings.workspaceId),
      })
    },
  })
}
