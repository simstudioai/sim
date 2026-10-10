/** Cache keys shared by server hydration and client integration-availability reads. */
export const integrationAvailabilityKeys = {
  all: ['allowedIntegrations'] as const,
  environments: () => [...integrationAvailabilityKeys.all, 'env'] as const,
}

/** Delay before cached availability is eligible for revalidation. */
export const INTEGRATION_AVAILABILITY_STALE_TIME = 5 * 60 * 1000
