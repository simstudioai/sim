import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'

/**
 * The error policy every catalog route shares.
 *
 * A workspace the caller cannot reach is concealed as absent, so the catalog
 * routes cannot be used to probe which workspace ids exist. Each detail route
 * additionally raises its own not-found for an unknown or gated resource.
 */
export const catalogErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
})
