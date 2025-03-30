import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'
import { updateOllamaProviderModels } from '@/providers/utils'

const logger = createLogger('OllamaStore')

interface OllamaState {
  models: string[]
  setModels: (models: string[]) => void
}

export const useOllamaStore = create<OllamaState>((set) => ({
  models: [],
  setModels: (models) => {
    logger.info('Updating Ollama models', { models })
    set({ models })
    // Update the providers when models change
    updateOllamaProviderModels(models)
  },
}))
