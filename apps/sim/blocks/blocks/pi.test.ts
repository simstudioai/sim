/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// The registry lives server-side (`keys.ts` reaches BYOK, which reaches the database) and the block
// deliberately does not import it — no block imports from `@/executor`. This test is what ties the
// two copies together, so adding a provider to one and not the other fails here.
vi.mock('@/lib/api-key/byok', () => ({ getBYOKKey: vi.fn(), getApiKeyWithBYOK: vi.fn() }))
vi.mock('@/lib/core/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/core/config/env')>()
  return {
    ...original,
    getEnv: vi.fn((key: string) => (key === 'NEXT_PUBLIC_E2B_ENABLED' ? 'true' : undefined)),
    isTruthy: vi.fn((value: unknown) => value === 'true'),
  }
})

import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { PiBlock } from '@/blocks/blocks/pi'
import { PI_SEARCH_PROVIDERS } from '@/executor/handlers/pi/keys'

const searchProviderField = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'searchProvider')
const searchApiKeyField = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'searchApiKey')

function searchKeyVisible(values: Record<string, unknown>): boolean {
  return evaluateSubBlockCondition(searchApiKeyField?.condition, values)
}

describe('Pi block search fields', () => {
  it('offers None plus exactly the providers the resolver knows, defaulting to None', () => {
    expect(searchProviderField?.type).toBe('dropdown')
    expect(searchProviderField?.defaultValue).toBe('none')

    const options = searchProviderField?.options as { id: string; label: string }[]
    expect(options.map(({ id }) => id)).toEqual(['none', ...Object.keys(PI_SEARCH_PROVIDERS)])
    // Labels too: a mismatch here means the dropdown names a provider differently from the setup
    // error the run fails with.
    expect(options.slice(1).map(({ label }) => label)).toEqual(
      Object.values(PI_SEARCH_PROVIDERS).map(({ label }) => label)
    )
  })

  // The same handling this block already gives githubToken, password, and privateKey.
  it('keeps the search key out of connections, references, and plain text', () => {
    expect(searchApiKeyField?.password).toBe(true)
    expect(searchApiKeyField?.paramVisibility).toBe('user-only')
    expect(searchApiKeyField?.connectionDroppable).toBe(false)
  })

  it('declares the key as dependent on the provider, which is what clears it in the editor', () => {
    expect(searchApiKeyField?.dependsOn).toEqual(['searchProvider'])
  })

  it('shows the key field only once a provider is selected', () => {
    expect(searchKeyVisible({ searchProvider: 'exa' })).toBe(true)
    expect(searchKeyVisible({ searchProvider: 'firecrawl' })).toBe(true)
    expect(searchKeyVisible({ searchProvider: 'none' })).toBe(false)
    expect(searchKeyVisible({ searchProvider: '' })).toBe(false)
  })

  // A Pi block saved before this field existed has no stored value, and the serializer does not
  // inject subBlock defaults — so `undefined` has to behave like None here too.
  it('hides the key field on blocks saved before the field existed', () => {
    expect(searchKeyVisible({})).toBe(false)
    expect(searchKeyVisible({ searchProvider: undefined })).toBe(false)
  })

  // The field is the only source for the search key — no workspace BYOK fallback, no hosted key —
  // so it has to be required. Safe despite the condition: the serializer's required check returns
  // early for fields that are not visible, which is what keeps a Pi block with search off from
  // failing validation over a key it does not need.
  it('requires the key, which the hidden case must not enforce', () => {
    expect(searchApiKeyField?.required).toBe(true)
    expect(searchKeyVisible({ searchProvider: 'none' })).toBe(false)
    expect(searchKeyVisible({})).toBe(false)
  })

  // `inputs` is the block's type map, not the delivery mechanism — the handler reads resolved
  // params — but an undeclared input is a convention break the next block author would copy.
  it('declares both fields in the block input map', () => {
    expect(PiBlock.inputs.searchProvider).toBeDefined()
    expect(PiBlock.inputs.searchApiKey).toBeDefined()
  })
})

describe('Pi Create PR Babysit surface', () => {
  it('offers exactly Create PR, Review Code, and Local Dev as top-level modes', () => {
    const mode = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'mode')
    const options =
      typeof mode?.options === 'function'
        ? mode.options()
        : (mode?.options as Array<{ id: string }> | undefined)

    expect(options?.map(({ id }) => id)).toEqual(['cloud', 'cloud_review', 'local'])
  })

  it('declares the toggle, required reviewer mentions, advanced rounds, and result outputs', () => {
    const toggle = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'babysitMode')
    const maxRounds = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'maxRounds')
    const mentions = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'reviewMentions')

    expect(toggle).toMatchObject({
      type: 'switch',
      defaultValue: false,
      condition: { field: 'mode', value: 'cloud' },
    })
    expect(maxRounds).toMatchObject({
      type: 'short-input',
      defaultValue: '3',
      mode: 'advanced',
      condition: {
        field: 'mode',
        value: 'cloud',
        and: { field: 'babysitMode', value: true },
      },
    })
    expect(mentions).toMatchObject({
      type: 'short-input',
      defaultValue: '',
      hideDividerBefore: true,
      required: {
        field: 'mode',
        value: 'cloud',
        and: { field: 'babysitMode', value: true },
      },
      condition: {
        field: 'mode',
        value: 'cloud',
        and: { field: 'babysitMode', value: true },
      },
    })
    for (const output of [
      'rounds',
      'threadsClean',
      'checksGreen',
      'threadsResolved',
      'commitsPushed',
      'stopReason',
    ]) {
      expect(PiBlock.outputs[output]).toMatchObject({
        condition: {
          field: 'mode',
          value: 'cloud',
          and: { field: 'babysitMode', value: true },
        },
      })
    }
  })

  it('requires a task and hides Draft PR while Babysit Mode is enabled', () => {
    const task = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'task')
    const draft = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'draft')
    const skills = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'skills')
    const tools = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'tools')
    const memory = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'memoryType')
    const pullNumber = PiBlock.subBlocks.find((subBlock) => subBlock.id === 'pullNumber')

    expect(task?.required).toBe(true)
    expect(evaluateSubBlockCondition(draft?.condition, { mode: 'cloud' })).toBe(true)
    expect(evaluateSubBlockCondition(draft?.condition, { mode: 'cloud', babysitMode: true })).toBe(
      false
    )
    expect(evaluateSubBlockCondition(skills?.condition, { mode: 'cloud' })).toBe(true)
    expect(evaluateSubBlockCondition(tools?.condition, { mode: 'cloud' })).toBe(false)
    expect(evaluateSubBlockCondition(memory?.condition, { mode: 'cloud' })).toBe(true)
    expect(evaluateSubBlockCondition(pullNumber?.condition, { mode: 'cloud' })).toBe(false)
    expect(evaluateSubBlockCondition(pullNumber?.condition, { mode: 'cloud_review' })).toBe(true)
  })
})
