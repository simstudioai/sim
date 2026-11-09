'use client'

import { useMemo } from 'react'
import { randomFloat } from '@sim/utils/random'
import type {
  SuggestedActionCandidate,
  SuggestedActionCatalog,
} from '@/lib/api/contracts/suggested-actions'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import { useSuggestedActionCatalog } from '@/hooks/queries/suggested-actions'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import type { HomeSuggestion } from '@/platform/shared/home'
import { integrationSegment } from '@/platform/shared/integrations'

/** Weighted sampling without replacement: each pick is proportional to its weight. */
function weightedSample<T>(pool: readonly T[], count: number, weightOf: (item: T) => number): T[] {
  const remaining = pool.map((item) => ({ item, weight: Math.max(weightOf(item), 0) }))
  const picked: T[] = []
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0)
    if (total <= 0) break
    let roll = randomFloat() * total
    const index = remaining.findIndex((entry) => {
      roll -= entry.weight
      return roll <= 0
    })
    const [entry] = remaining.splice(index === -1 ? remaining.length - 1 : index, 1)
    picked.push(entry.item)
  }
  return picked
}

/**
 * Legacy's weighting: a prompt for a connected service runs at once and weighs most, an unconnected
 * one still teaches what is possible, and table starters lead where there are no tables yet.
 */
function scoreCandidate(candidate: SuggestedActionCandidate, connected: ReadonlySet<string>) {
  let weight = 1
  if (candidate.featured) weight *= 3
  if (candidate.popular) weight *= 1.5
  if (candidate.providerId) weight *= connected.has(candidate.providerId) ? 4 : 0.4
  if (candidate.modules.includes('tables')) weight *= 1.5
  return weight
}

/**
 * Four suggestions as legacy chose them: connect rows for services not yet connected, weighted by
 * how many templates each has, then prompts with at most one per block. A viewer with a connection
 * gets one connect row and three prompts; a viewer without gets two of each.
 */
function chooseSuggestions(
  catalog: SuggestedActionCatalog,
  entries: readonly MemberIntegration[],
  integrationHref: (entry: MemberIntegration) => string
): HomeSuggestion[] {
  const connected = new Set(
    entries.filter((entry) => entry.accounts.length > 0).map((entry) => entry.provider)
  )
  const connectable = entries.filter(
    (entry) => !entry.managed && entry.connectionTarget && entry.accounts.length === 0
  )
  const connects = weightedSample(
    connectable,
    connected.size === 0 ? 2 : 1,
    (entry) => (catalog.templateCounts[entry.provider] ?? 0) + 1
  ).map(
    (entry): HomeSuggestion => ({
      kind: 'integration',
      id: `integrate-${entry.id}`,
      label: `Integrate with ${entry.name}`,
      providerId: integrationSegment(entry.id),
      href: integrationHref(entry),
    })
  )
  const scored = catalog.candidates.map((candidate) => ({
    candidate,
    weight: scoreCandidate(candidate, connected),
  }))
  const prompts: HomeSuggestion[] = []
  const usedBlocks = new Set<string>()
  while (prompts.length < 4 - connects.length) {
    const available = scored.filter((entry) => !usedBlocks.has(entry.candidate.blockType))
    const [pick] = weightedSample(available, 1, (entry) => entry.weight)
    if (!pick) break
    const { candidate } = pick
    usedBlocks.add(candidate.blockType)
    prompts.push({
      kind: 'prompt',
      id: candidate.id,
      label: candidate.label,
      prompt: candidate.prompt,
      ...(candidate.starter ? {} : { providerId: candidate.blockType }),
    })
  }
  return [...connects, ...prompts]
}

/**
 * Home's suggested actions, sampled once both the template catalog and the viewer's integrations
 * have settled, so the rows never change under the pointer. Nothing shows before then.
 */
export function useHomeSuggestions(
  organization: PlatformOrganization,
  entries: readonly MemberIntegration[] | undefined,
  enabled: boolean
): readonly HomeSuggestion[] {
  const catalog = useSuggestedActionCatalog({ enabled })
  const data = catalog.data
  return useMemo(
    () =>
      enabled && data && entries
        ? chooseSuggestions(data, entries, (entry) =>
            surfaceHref(organization, `/integrations/${integrationSegment(entry.id)}`)
          )
        : [],
    [enabled, data, entries, organization]
  )
}
