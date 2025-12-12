export interface EnvironmentVariable {
  key: string
  value: string
}

export interface CachedWorkspaceEnvData {
  workspace: Record<string, string>
  personal: Record<string, string>
  conflicts: string[]
  cachedAt: number
}

export interface EnvironmentState {
  variables: Record<string, EnvironmentVariable>
  isLoading: boolean
  error: string | null
}

export interface EnvironmentStore extends EnvironmentState {
  loadEnvironmentVariables: () => Promise<void>
  setVariables: (variables: Record<string, EnvironmentVariable>) => void
  getAllVariables: () => Record<string, EnvironmentVariable>
  reset: () => void
}
