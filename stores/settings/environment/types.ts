export interface EnvironmentVariable {
  key: string
  value: string
}

export interface EnvironmentState {
  variables: Record<string, EnvironmentVariable>
}

export interface EnvironmentStore extends EnvironmentState {
  setVariable: (key: string, value: string) => void
  removeVariable: (key: string) => void
  clearVariables: () => void
  getVariable: (key: string) => string | undefined
  getAllVariables: () => Record<string, EnvironmentVariable>
  syncWithDatabase: () => Promise<void>
}
