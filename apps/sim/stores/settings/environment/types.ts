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
