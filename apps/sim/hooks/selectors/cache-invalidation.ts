import type { QueryClient } from '@tanstack/react-query'

/**
 * Browser cache prefixes whose results can depend on server-resolved selector context.
 * Keep the factories and invalidation path on the same constants so a new selector cache
 * cannot silently miss environment-change invalidation.
 */
export const environmentDependentSelectorKeys = {
  primary: ['selectors'] as const,
  dynamicDetails: ['dynamic-subblock-options', 'detail'] as const,
  workflowDetails: ['workflow-search-replace', 'resource-detail', 'selector'] as const,
  workflowReplacementOptions: [
    'workflow-search-replace',
    'replacement-options',
    'selector',
  ] as const,
}

/** Refetch mounted selector consumers after an environment value changes behind an opaque key. */
export async function invalidateEnvironmentDependentSelectorQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: environmentDependentSelectorKeys.primary }),
    queryClient.invalidateQueries({ queryKey: environmentDependentSelectorKeys.dynamicDetails }),
    queryClient.invalidateQueries({ queryKey: environmentDependentSelectorKeys.workflowDetails }),
    queryClient.invalidateQueries({
      queryKey: environmentDependentSelectorKeys.workflowReplacementOptions,
    }),
  ])
}
