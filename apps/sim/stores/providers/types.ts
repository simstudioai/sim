export type ProviderName = 'ollama' | 'vllm' | 'openrouter' | 'base'

export interface OpenRouterModelInfo {
  id: string
  contextLength?: number
  supportsStructuredOutputs?: boolean
  supportsTools?: boolean
  pricing?: {
    input: number
    output: number
  }
}

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  openRouterModelInfo: Record<string, OpenRouterModelInfo>
  setProviderModels: (provider: ProviderName, models: string[]) => void
  setProviderLoading: (provider: ProviderName, isLoading: boolean) => void
  setOpenRouterModelInfo: (modelInfo: Record<string, OpenRouterModelInfo>) => void
  getProvider: (provider: ProviderName) => ProviderState
  getOpenRouterModelInfo: (modelId: string) => OpenRouterModelInfo | undefined
}
