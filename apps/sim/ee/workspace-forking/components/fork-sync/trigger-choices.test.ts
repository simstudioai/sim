/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkTriggerMapping } from '@/lib/api/contracts/workspace-fork'
import {
  forkDyingTriggerUrls,
  forkTriggerChoices,
  forkTriggerPathOwners,
} from '@/ee/workspace-forking/components/fork-sync/trigger-choices'

function mapping(overrides: Partial<ForkTriggerMapping> = {}): ForkTriggerMapping {
  return {
    sourceBlockId: 'blk',
    blockName: 'Slack messages',
    workflowName: 'ITSM intake',
    ownPath: null,
    adoptablePaths: ['p1'],
    defaultAdoptPath: 'p1',
    ...overrides,
  }
}

describe('forkTriggerChoices', () => {
  it('takes the default when the user has not chosen', () => {
    expect(forkTriggerChoices([mapping()], {}).get('blk')).toBe('p1')
  })

  it('honours an explicit pick over the default', () => {
    const mappings = [mapping({ adoptablePaths: ['p1', 'p2'], defaultAdoptPath: null })]
    expect(forkTriggerChoices(mappings, { blk: 'p2' }).get('blk')).toBe('p2')
  })

  it("treats an explicit '' as minting a new URL, overriding the default", () => {
    expect(forkTriggerChoices([mapping()], { blk: '' }).get('blk')).toBe('')
  })

  it('ignores a pick the slot never offered', () => {
    expect(forkTriggerChoices([mapping()], { blk: 'not-offered' }).get('blk')).toBe('')
  })

  /**
   * Two blocks cannot serve one path (`path_deployment_unique`) and the server awards it to the
   * first slot, so the second row's real outcome is a NEW URL - not the path it asked for.
   */
  it('awards a contested path to the first row only', () => {
    const mappings = [
      mapping({ sourceBlockId: 'a', blockName: 'Slack A', defaultAdoptPath: null }),
      mapping({ sourceBlockId: 'b', blockName: 'Slack B', defaultAdoptPath: null }),
    ]
    const chosen = forkTriggerChoices(mappings, { a: 'p1', b: 'p1' })
    expect(chosen.get('a')).toBe('p1')
    expect(chosen.get('b')).toBe('')
  })
})

describe('forkDyingTriggerUrls', () => {
  const retiring = [
    { workflowName: 'ITSM intake', path: 'p1' },
    { workflowName: 'ITSM intake', path: 'p2' },
  ]

  it('excludes a URL some row adopts', () => {
    const chosen = forkTriggerChoices([mapping()], {})
    expect(forkDyingTriggerUrls(retiring, chosen).map((r) => r.path)).toEqual(['p2'])
  })

  /**
   * The bug this exists for: the server computes its warning from the DEFAULT resolution, so
   * choosing "Generate new URL" used to kill a URL the confirm never mentioned.
   */
  it('re-lists a URL once the user opts into a new one instead', () => {
    const chosen = forkTriggerChoices([mapping()], { blk: '' })
    expect(forkDyingTriggerUrls(retiring, chosen).map((r) => r.path)).toEqual(['p1', 'p2'])
  })

  it('drops a URL the user adopts where the default adopted nothing', () => {
    const mappings = [mapping({ adoptablePaths: ['p1', 'p2'], defaultAdoptPath: null })]
    const chosen = forkTriggerChoices(mappings, { blk: 'p2' })
    expect(forkDyingTriggerUrls(retiring, chosen).map((r) => r.path)).toEqual(['p1'])
  })

  /** A contested path is still served by its winner, so it is not dying. */
  it('counts a contested path as adopted exactly once', () => {
    const mappings = [
      mapping({ sourceBlockId: 'a', defaultAdoptPath: null }),
      mapping({ sourceBlockId: 'b', defaultAdoptPath: null }),
    ]
    const chosen = forkTriggerChoices(mappings, { a: 'p1', b: 'p1' })
    expect(forkDyingTriggerUrls(retiring, chosen).map((r) => r.path)).toEqual(['p2'])
  })
})

describe('forkTriggerPathOwners', () => {
  const mappings = [
    mapping({ sourceBlockId: 'a', blockName: 'Slack A', defaultAdoptPath: null }),
    mapping({ sourceBlockId: 'b', blockName: 'Slack B', defaultAdoptPath: null }),
  ]

  it('names the row that claimed a path, from another row’s perspective', () => {
    const chosen = forkTriggerChoices(mappings, { a: 'p1' })
    expect(forkTriggerPathOwners(mappings, chosen, 'b').get('p1')).toBe('Slack A')
  })

  it('never reports a row as the owner of its own claim', () => {
    const chosen = forkTriggerChoices(mappings, { a: 'p1' })
    expect(forkTriggerPathOwners(mappings, chosen, 'a').has('p1')).toBe(false)
  })

  it('reports nothing while no row has claimed anything', () => {
    const chosen = forkTriggerChoices(mappings, {})
    expect(forkTriggerPathOwners(mappings, chosen, 'b').size).toBe(0)
  })
})
