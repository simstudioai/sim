export interface EnvironmentVariable {
  key: string
  value: string
}

export interface EnvironmentState {
  variables: Record<string, EnvironmentVariable>
}

export interface EnvironmentStore extends EnvironmentState {
  setVariables: (variables: Record<string, string>) => void
  getVariable: (key: string) => string | undefined
  getAllVariables: () => Record<string, EnvironmentVariable>
}
