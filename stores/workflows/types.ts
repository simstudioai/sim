// Re-export all types from individual stores for convenience
export * from './registry/types'
export * from './workflow/types'
export * from './history-types'

// Additional shared types can be defined here
export interface PersistenceOptions {
  enabled: boolean
  syncWithServer: boolean
}

export interface StoreOptions {
  persistence?: PersistenceOptions
  devtools?: boolean
}
