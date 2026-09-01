import type { ForkTriggerMapping, ForkTriggerUrlChange } from '@/lib/api/contracts/workspace-fork'

/**
 * Which retiring URL each arriving trigger currently takes, keyed by source block id. `''` means
 * "mint a new URL".
 *
 * Mirrors `resolveForkTriggerPaths` on the server, which is what makes the preview trustworthy:
 * an override counts only for a path the slot actually offered, and a path is awarded to the
 * FIRST row that claims it - two blocks cannot serve one path (`path_deployment_unique`), so a
 * later row claiming the same URL silently receives a new one instead.
 */
export function forkTriggerChoices(
  mappings: readonly ForkTriggerMapping[],
  adoptions: Readonly<Record<string, string>>
): Map<string, string> {
  const chosen = new Map<string, string>()
  const claimed = new Set<string>()
  for (const mapping of mappings) {
    const picked =
      mapping.sourceBlockId in adoptions
        ? adoptions[mapping.sourceBlockId]
        : (mapping.defaultAdoptPath ?? '')
    const honoured =
      picked !== '' && mapping.adoptablePaths.includes(picked) && !claimed.has(picked) ? picked : ''
    if (honoured !== '') claimed.add(honoured)
    chosen.set(mapping.sourceBlockId, honoured)
  }
  return chosen
}

/**
 * The retiring URLs the CURRENT choices leave unserved.
 *
 * Derived from the raw retiring set rather than read off the diff: the server computes its own
 * default before the user picks anything, so a preview built from it would omit a URL the user
 * has just chosen to abandon - in the one modal that exists to state irreversible consequences.
 */
export function forkDyingTriggerUrls(
  retiring: readonly ForkTriggerUrlChange[],
  chosen: ReadonlyMap<string, string>
): ForkTriggerUrlChange[] {
  const adopted = new Set(Array.from(chosen.values()).filter((path) => path !== ''))
  return retiring.filter((row) => !adopted.has(row.path))
}

/**
 * The block name already claiming each path, from the perspective of one row - so its picker can
 * disable a URL another trigger took rather than letting the user select a choice the sync will
 * silently overrule.
 */
export function forkTriggerPathOwners(
  mappings: readonly ForkTriggerMapping[],
  chosen: ReadonlyMap<string, string>,
  forSourceBlockId: string
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const mapping of mappings) {
    if (mapping.sourceBlockId === forSourceBlockId) continue
    const pick = chosen.get(mapping.sourceBlockId)
    if (pick) owners.set(pick, mapping.blockName)
  }
  return owners
}
