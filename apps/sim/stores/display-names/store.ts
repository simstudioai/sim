import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DisplayNamesStore')

/**
 * Generic cache for ID-to-name mappings for all selector types
 * Structure: { type: { context: { id: name } } }
 *
 */
interface DisplayNamesCache {
  credentials: Record<string, Record<string, string>> // provider -> id -> name
  channels: Record<string, Record<string, string>> // credentialContext -> id -> name
  knowledgeBases: Record<string, Record<string, string>> // workspaceId -> id -> name
  workflows: Record<string, Record<string, string>> // always 'global' -> id -> name
  files: Record<string, Record<string, string>> // credentialContext -> id -> name
  folders: Record<string, Record<string, string>> // credentialContext -> id -> name
  projects: Record<string, Record<string, string>> // provider-credential -> id -> name
  documents: Record<string, Record<string, string>> // knowledgeBaseId -> id -> name
}

interface DisplayNamesStore {
  cache: DisplayNamesCache

  /**
   * Set a display name for an ID
   */
  setDisplayName: (type: keyof DisplayNamesCache, context: string, id: string, name: string) => void

  /**
   * Set multiple display names at once
   */
  setDisplayNames: (
    type: keyof DisplayNamesCache,
    context: string,
    items: Record<string, string>
  ) => void

  /**
   * Get a display name for an ID
   */
  getDisplayName: (type: keyof DisplayNamesCache, context: string, id: string) => string | null

  /**
   * Remove a single display name
   */
  removeDisplayName: (type: keyof DisplayNamesCache, context: string, id: string) => void

  /**
   * Clear all cached display names for a type/context
   */
  clearContext: (type: keyof DisplayNamesCache, context: string) => void

  /**
   * Clear all cached display names
   */
  clearAll: () => void
}

const initialCache: DisplayNamesCache = {
  credentials: {},
  channels: {},
  knowledgeBases: {},
  workflows: {},
  files: {},
  folders: {},
  projects: {},
  documents: {},
}

export const useDisplayNamesStore = create<DisplayNamesStore>((set, get) => ({
  cache: initialCache,

  setDisplayName: (type, context, id, name) => {
    set((state) => ({
      cache: {
        ...state.cache,
        [type]: {
          ...state.cache[type],
          [context]: {
            ...state.cache[type][context],
            [id]: name,
          },
        },
      },
    }))
  },

  setDisplayNames: (type, context, items) => {
    set((state) => ({
      cache: {
        ...state.cache,
        [type]: {
          ...state.cache[type],
          [context]: {
            ...state.cache[type][context],
            ...items,
          },
        },
      },
    }))

    logger.info(`Cached ${Object.keys(items).length} display names`, { type, context })
  },

  getDisplayName: (type, context, id) => {
    const contextCache = get().cache[type][context]
    return contextCache?.[id] || null
  },

  removeDisplayName: (type, context, id) => {
    set((state) => {
      const contextCache = { ...state.cache[type][context] }
      delete contextCache[id]
      return {
        cache: {
          ...state.cache,
          [type]: {
            ...state.cache[type],
            [context]: contextCache,
          },
        },
      }
    })
  },

  clearContext: (type, context) => {
    set((state) => {
      const newTypeCache = { ...state.cache[type] }
      delete newTypeCache[context]
      return {
        cache: {
          ...state.cache,
          [type]: newTypeCache,
        },
      }
    })
  },

  clearAll: () => {
    set({ cache: initialCache })
  },
}))
