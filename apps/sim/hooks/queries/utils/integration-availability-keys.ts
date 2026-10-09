export const integrationAvailabilityKeys = {
  all: ['allowedIntegrations'] as const,
  environments: () => [...integrationAvailabilityKeys.all, 'env'] as const,
}

export const INTEGRATION_AVAILABILITY_STALE_TIME = 5 * 60 * 1000
