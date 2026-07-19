/**
 * Workspace interfaces domain module.
 *
 * Server-side consumers (API routes, the form submit route, the copilot
 * `user_interface` tool) import from this barrel. Client code must import
 * type-only from here — `service.ts` and `validation.ts` touch the database.
 * The leaves client code may import at runtime are `constants.ts` (limits,
 * name rules, module defaults), `geometry.ts` (all grid arithmetic),
 * `form-config.ts` (the form-authoring validity rules), and
 * `form-submission.ts` (the submission validator), all of which are
 * database-free by construction.
 */

export * from '@/lib/interfaces/constants'
export * from '@/lib/interfaces/form-config'
export * from '@/lib/interfaces/form-submission'
export * from '@/lib/interfaces/geometry'
export * from '@/lib/interfaces/orchestration'
export * from '@/lib/interfaces/schema'
export * from '@/lib/interfaces/service'
export * from '@/lib/interfaces/types'
export * from '@/lib/interfaces/validation'
