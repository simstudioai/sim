import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isEnvVarReference, isReference } from '@/executor/constants'
import { getSelectorDefinition, mergeOption } from '@/hooks/selectors/registry'
import type { SelectorKey, SelectorOption, SelectorQueryArgs } from '@/hooks/selectors/types'

interface SelectorHookArgs extends Omit<SelectorQueryArgs, 'key'> {
  search?: string
  detailId?: string
  enabled?: boolean
}

export function useSelectorOptions(key: SelectorKey, args: SelectorHookArgs) {
  const definition = getSelectorDefinition(key)
  const queryArgs: SelectorQueryArgs = {
    key,
    context: args.context,
    search: args.search,
  }
  const isEnabled = args.enabled ?? (definition.enabled ? definition.enabled(queryArgs) : true)
  return useQuery<SelectorOption[]>({
    queryKey: definition.getQueryKey(queryArgs),
    queryFn: () => definition.fetchList(queryArgs),
    enabled: isEnabled,
    staleTime: definition.staleTime ?? 30_000,
  })
}

export function useSelectorOptionDetail(
  key: SelectorKey,
  args: SelectorHookArgs & { detailId?: string }
) {
  const definition = getSelectorDefinition(key)
  const queryArgs: SelectorQueryArgs = {
    key,
    context: args.context,
    detailId: args.detailId,
  }
  const hasRealDetailId =
    Boolean(args.detailId) && !isReference(args.detailId!) && !isEnvVarReference(args.detailId!)
  const baseEnabled =
    hasRealDetailId && definition.fetchById !== undefined
      ? definition.enabled
        ? definition.enabled(queryArgs)
        : true
      : false
  const enabled = args.enabled ?? baseEnabled

  const query = useQuery<SelectorOption | null>({
    queryKey: [...definition.getQueryKey(queryArgs), 'detail', args.detailId ?? 'none'],
    queryFn: () => definition.fetchById!(queryArgs),
    enabled,
    staleTime: definition.staleTime ?? 300_000,
  })

  return query
}

export function useSelectorOptionMap(options: SelectorOption[], extra?: SelectorOption | null) {
  return useMemo(() => {
    const merged = mergeOption(options, extra)
    return new Map(merged.map((option) => [option.id, option]))
  }, [options, extra])
}
