/**
 * @vitest-environment node
 */

import { omit } from '@sim/utils/object'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import { projectLegacySlackV2Auth } from '@/lib/workflows/compatibility/slack-v2-auth'
import { createHistoricalSlackV2Block } from '@/lib/workflows/compatibility/slack-v2-auth.fixtures'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'
import { extractBlockParams } from '@/serializer'

const getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)

afterAll(() => {
  getBlockSpy.mockRestore()
})

function workflowWith(block: BlockState): WorkflowState {
  return { blocks: { [block.id]: block }, edges: [], loops: {}, parallels: {} }
}

describe('projectLegacySlackV2Auth', () => {
  it('makes the historical custom-bot action behave like its current equivalent', () => {
    const historical = createHistoricalSlackV2Block()
    const original = structuredClone(historical)
    const equivalentCurrent = structuredClone(historical)
    equivalentCurrent.subBlocks = omit(equivalentCurrent.subBlocks, [
      'authMethod',
      'customBotCredential',
      'manualCustomBotCredential',
    ])
    equivalentCurrent.subBlocks.credential.value = 'credential-custom-bot'
    const blocks = projectLegacySlackV2Auth({ [historical.id]: historical })
    const projected = blocks[historical.id]

    expect(historical).toEqual(original)
    expect(projected.subBlocks).not.toHaveProperty('authMethod')
    expect(projected.subBlocks).not.toHaveProperty('customBotCredential')
    expect(projected.subBlocks.credential.value).toBe('credential-custom-bot')
    expect(projected.data?.canonicalModes).toMatchObject({
      oauthCredential: 'basic',
      botCredential: 'basic',
    })

    const selectorContext = buildSelectorContextFromBlock(projected.type, projected.subBlocks, {
      selectorKey: 'slack.channels',
      dependsOn: ['credential'],
      canonicalModes: projected.data?.canonicalModes,
    })
    expect(selectorContext.oauthCredential).toBe('credential-custom-bot')

    const params = extractBlockParams(projected)
    expect(params).toMatchObject({
      oauthCredential: 'credential-custom-bot',
      channel: 'C123456789',
    })
    expect(params).not.toHaveProperty('botCredential')

    expect(
      generateWorkflowDiffSummary(workflowWith(equivalentCurrent), workflowWith(projected))
        .hasChanges
    ).toBe(false)
  })

  it('honors the historical custom-bot and OAuth modes', () => {
    const historical = createHistoricalSlackV2Block()
    historical.data!.canonicalModes!.botCredential = 'advanced'
    historical.subBlocks.manualCustomBotCredential.value = 'credential-manual-bot'

    const projected = projectLegacySlackV2Auth({ [historical.id]: historical })[historical.id]

    expect(projected.subBlocks.credential.value).toBeNull()
    expect(projected.subBlocks.manualCredential.value).toBe('credential-manual-bot')
    expect(projected.data?.canonicalModes?.oauthCredential).toBe('advanced')

    const historicalOauth = createHistoricalSlackV2Block()
    historicalOauth.subBlocks.authMethod.value = 'oauth'
    const projectedOauth = projectLegacySlackV2Auth({ slack: historicalOauth }).slack
    expect(projectedOauth.subBlocks.credential.value).toBe('dormant-oauth')
  })

  it('leaves current, trigger, and unidentifiable states untouched', () => {
    const cases = [
      createHistoricalSlackV2Block(),
      createHistoricalSlackV2Block(),
      createHistoricalSlackV2Block(),
    ]
    cases[0].subBlocks = omit(cases[0].subBlocks, ['authMethod'])
    cases[1].triggerMode = true
    cases[2].subBlocks.authMethod.value = null

    for (const block of cases) {
      const blocks = { [block.id]: block }
      expect(projectLegacySlackV2Auth(blocks)).toBe(blocks)
    }
  })

  it('does not substitute a dormant OAuth account for a missing historical bot credential', () => {
    const historical = createHistoricalSlackV2Block()
    historical.subBlocks.customBotCredential.value = null

    const projected = projectLegacySlackV2Auth({ [historical.id]: historical })[historical.id]

    expect(projected.subBlocks.credential.value).toBeNull()
    expect(
      buildSelectorContextFromBlock(projected.type, projected.subBlocks, {
        selectorKey: 'slack.channels',
        dependsOn: ['credential'],
        canonicalModes: projected.data?.canonicalModes,
      }).oauthCredential
    ).toBeUndefined()
  })
})
