export type ProviderName = 'ollama' | 'vllm' | 'openrouter' | 'base' | 'sambanova'

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  setProviderModels: (provider: ProviderName, models: string[]) => void
  setProviderLoading: (provider: ProviderName, isLoading: boolean) => void
  getProvider: (provider: ProviderName) => ProviderState
}
