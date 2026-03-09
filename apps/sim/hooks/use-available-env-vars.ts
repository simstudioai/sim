import { useMemo } from 'react'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'

export function useAvailableEnvVarKeys(workspaceId?: string): Set<string> | undefined {
  const { data: personalEnv, isLoading: personalLoading } = usePersonalEnvironment()
  const { data: workspaceEnvData, isLoading: workspaceLoading } = useWorkspaceEnvironment(
    workspaceId || ''
  )

  return useMemo(() => {
    if (personalLoading || (workspaceId && workspaceLoading)) {
      return undefined
    }

    const keys = new Set<string>()

    if (personalEnv) {
      Object.keys(personalEnv).forEach((key) => keys.add(key))
    }

    if (workspaceId && workspaceEnvData) {
      if (workspaceEnvData.workspace) {
        Object.keys(workspaceEnvData.workspace).forEach((key) => keys.add(key))
      }
      if (workspaceEnvData.personal) {
        Object.keys(workspaceEnvData.personal).forEach((key) => keys.add(key))
      }
    }

    return keys
  }, [personalEnv, workspaceEnvData, personalLoading, workspaceLoading, workspaceId])
}

export function createShouldHighlightEnvVar(
  availableEnvVars: Set<string> | undefined
): (varName: string) => boolean {
  return (varName: string): boolean => {
    if (availableEnvVars === undefined) {
      return true
    }
    return availableEnvVars.has(varName)
  }
}
