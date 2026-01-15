/**
 * Table utilities module.
 *
 * Provides validation, query building, service layer, and filter utilities
 * for user-defined tables.
 *
 * Hooks are not re-exported here to avoid pulling React into server code.
 * Import hooks directly from '@/lib/table/hooks' in client components.
 *
 * @module lib/table
 */

export * from './constants'
export * from './filters'
export * from './query-builder'
export * from './service'
export * from './types'
export * from './validation'
