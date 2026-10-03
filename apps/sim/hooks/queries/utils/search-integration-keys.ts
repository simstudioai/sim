export const searchIntegrationKeys = {
  all: ['search-integrations'] as const,
  lists: () => [...searchIntegrationKeys.all, 'list'] as const,
  list: (organizationId: string) => [...searchIntegrationKeys.lists(), organizationId] as const,
}
