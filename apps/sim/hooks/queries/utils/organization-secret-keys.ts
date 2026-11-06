import type { SecretSourceMode } from '@/lib/organization-secrets/validation'

/**
 * Query keys for an organization's secrets. Not a `'use client'` module, so a server prefetch can
 * seed the same entry the client hook reads.
 */
export const ORGANIZATION_SECRET_STALE_TIME = 60 * 1000

export const organizationSecretKeys = {
  all: ['organization-secrets'] as const,
  sources: () => [...organizationSecretKeys.all, 'source'] as const,
  source: (organizationId: string) =>
    [...organizationSecretKeys.sources(), organizationId] as const,
  environments: (organizationId: string) =>
    [...organizationSecretKeys.all, 'environment', organizationId] as const,
  environment: (organizationId: string, mode: SecretSourceMode) =>
    [...organizationSecretKeys.environments(organizationId), mode] as const,
}
