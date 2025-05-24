import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'
import { updateOllamaProviderModels } from '@/providers/utils'
import type { OllamaStore } from './types'

const logger = createLogger('OllamaStore')

export const useOllamaStore = create<OllamaStore>((set) => ({
  models: [],
  setModels: (models) => {
    logger.info('Updating Ollama models', { models })
    set({ models })
    // Update the providers when models change
    updateOllamaProviderModels(models)
  },
}))
