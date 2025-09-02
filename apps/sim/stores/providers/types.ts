export type ProviderName = 'ollama' | 'openrouter'

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  setModels: (provider: ProviderName, models: string[]) => void
  fetchModels: (provider: ProviderName) => Promise<void>
  getProvider: (provider: ProviderName) => ProviderState
}

export interface ProviderConfig {
  apiEndpoint: string
  dedupeModels?: boolean
  updateFunction: (models: string[]) => void | Promise<void>
}
