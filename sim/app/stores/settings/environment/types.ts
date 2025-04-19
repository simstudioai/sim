export interface EnvironmentVariable {
  key: string
  value: string
}

export interface EnvironmentState {
  variables: Record<string, EnvironmentVariable>
  isLoading: boolean
  error: string | null
}

export interface EnvironmentStore extends EnvironmentState {
  // Legacy method
  setVariables: (variables: Record<string, string>) => void

  // New methods for direct DB interaction
  loadEnvironmentVariables: () => Promise<void>
  saveEnvironmentVariables: (variables: Record<string, string>) => Promise<void>

  // Utility methods
  getVariable: (key: string) => string | undefined
  getAllVariables: () => Record<string, EnvironmentVariable>
}
