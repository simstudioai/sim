export interface OllamaStore {
  models: string[]
  isLoading: boolean
  setModels: (models: string[]) => void
  fetchModels: () => Promise<void>
}
