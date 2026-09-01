/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { isSelectorReady } from '@/lib/selectors/manifest'
import * as blocksBarrel from '@/blocks'
import { getAllBlocks, getBlock as getRealBlock } from '@/blocks/registry'
import {
  buildSelectorContextFromBlock,
  getSelectorContextSubBlocks,
  SELECTOR_CONTEXT_FIELDS,
} from './context'
import { buildCanonicalIndex, isCanonicalPair, resolveDependencyValue } from './visibility'

/**
 * Under `isolate: false` the module under test may already be cached from an
 * earlier test file, bound to the global `@/blocks/registry` mock through the
 * `@/blocks` barrel. `vi.unmock` alone cannot rebind that cached instance, so
 * route the barrel's `getBlock` to the real registry via a spy on the shared
 * barrel namespace — it patches whichever instance the cached module reads.
 */
const getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)

afterAll(() => {
  getBlockSpy.mockRestore()
})

function subBlocksFromValues(values: Record<string, unknown>): Record<string, { value: unknown }> {
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]))
}

describe('buildSelectorContextFromBlock', () => {
  it('should extract knowledgeBaseId from knowledgeBaseSelector via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('kb-uuid-123')
  })

  it('should extract knowledgeBaseId from manualKnowledgeBaseId via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      manualKnowledgeBaseId: {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        value: 'manual-kb-id',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('manual-kb-id')
  })

  it('resolves the ACTIVE member when both basic and advanced hold values (no last-write-wins)', () => {
    const subBlocks = {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-basic',
      },
      manualKnowledgeBaseId: {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        value: 'kb-advanced',
      },
    }
    // No override: the value heuristic keeps basic (matches a default-basic migrated block).
    expect(buildSelectorContextFromBlock('knowledge', subBlocks).knowledgeBaseId).toBe('kb-basic')
    // Explicit advanced toggle: the active member wins (the dormant basic value never leaks).
    expect(
      buildSelectorContextFromBlock('knowledge', subBlocks, {
        canonicalModes: { knowledgeBaseId: 'advanced' },
      }).knowledgeBaseId
    ).toBe('kb-advanced')
  })

  it('should skip null/empty values', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: '',
      },
    })

    expect(ctx.knowledgeBaseId).toBeUndefined()
  })

  it('skips a run-time reference so a dependent selector stays disabled instead of fetching it', () => {
    const ctx = buildSelectorContextFromBlock('table_v2', {
      operation: { id: 'operation', type: 'dropdown', value: 'query_rows' },
      manualTableId: { id: 'manualTableId', type: 'short-input', value: '<start.tableId>' },
    })

    expect(ctx.tableId).toBeUndefined()
  })

  it('should return empty context for unknown block types', () => {
    const ctx = buildSelectorContextFromBlock('nonexistent_block', {
      foo: { id: 'foo', type: 'short-input', value: 'bar' },
    })

    expect(ctx).toEqual({})
  })

  it('should pass through workflowId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workflowId: 'wf-123' }
    )

    expect(ctx.workflowId).toBe('wf-123')
  })

  it('should pass through workspaceId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workspaceId: 'ws-123' }
    )

    expect(ctx.workspaceId).toBe('ws-123')
  })

  it('exposes the NetSuite async job ID to dependent task selectors', () => {
    const ctx = buildSelectorContextFromBlock('netsuite', {
      operation: { id: 'operation', type: 'dropdown', value: 'netsuite_get_async_status' },
      jobId: { id: 'jobId', type: 'short-input', value: 'job-7' },
    })

    expect(ctx.jobId).toBe('job-7')
  })

  it('exposes the active Bitbucket workspace slug to repository selectors', () => {
    const subBlocks = {
      operation: {
        id: 'operation',
        type: 'dropdown',
        value: 'bitbucket_get_repository',
      },
      workspacePicker: {
        id: 'workspacePicker',
        type: 'project-selector',
        value: 'acme-platform',
      },
      workspaceSlugInput: {
        id: 'workspaceSlugInput',
        type: 'short-input',
        value: 'advanced-team',
      },
    }

    expect(buildSelectorContextFromBlock('bitbucket', subBlocks).workspaceSlug).toBe(
      'acme-platform'
    )
    expect(
      buildSelectorContextFromBlock('bitbucket', subBlocks, {
        canonicalModes: { workspaceSlug: 'advanced' },
      }).workspaceSlug
    ).toBe('advanced-team')
  })

  it('preserves Gmail action credential resolution in basic and advanced modes', () => {
    const subBlocks = subBlocksFromValues({
      credential: 'action-basic',
      manualCredential: 'action-advanced',
    })

    expect(buildSelectorContextFromBlock('gmail', subBlocks).oauthCredential).toBe('action-basic')
    expect(
      buildSelectorContextFromBlock('gmail', subBlocks, {
        canonicalModes: { oauthCredential: 'advanced' },
      }).oauthCredential
    ).toBe('action-advanced')
    expect(
      buildSelectorContextFromBlock(
        'gmail',
        subBlocksFromValues({ credential: '', triggerCredentials: 'dormant-trigger' })
      ).oauthCredential
    ).toBeUndefined()
  })

  it('preserves exact environment references through the strict selector context path', () => {
    const subBlocks = subBlocksFromValues({
      credential: '{{GMAIL_BASIC_CREDENTIAL}}',
      manualCredential: '{{GMAIL_SHARED_CREDENTIAL_ID}}',
    })

    expect(
      buildSelectorContextFromBlock('gmail', subBlocks, {
        selectorKey: 'gmail.labels',
        dependsOn: ['credential', 'manualCredential'],
      }).oauthCredential
    ).toBe('{{GMAIL_BASIC_CREDENTIAL}}')
    expect(
      buildSelectorContextFromBlock('gmail', subBlocks, {
        selectorKey: 'gmail.labels',
        dependsOn: ['credential', 'manualCredential'],
        canonicalModes: { oauthCredential: 'advanced' },
      }).oauthCredential
    ).toBe('{{GMAIL_SHARED_CREDENTIAL_ID}}')
  })

  it('includes Google impersonation as an explicit active selector hint', () => {
    const context = buildSelectorContextFromBlock(
      'gmail',
      subBlocksFromValues({
        credential: '{{GMAIL_CREDENTIAL_ID}}',
        impersonateUserEmail: '{{GMAIL_IMPERSONATE_EMAIL}}',
      }),
      {
        selectorKey: 'gmail.labels',
        dependsOn: ['credential'],
      }
    )

    expect(context).toEqual({
      oauthCredential: '{{GMAIL_CREDENTIAL_ID}}',
      impersonateUserEmail: '{{GMAIL_IMPERSONATE_EMAIL}}',
    })
  })

  it('projects only the active Slack auth source plus trigger credentials', () => {
    const oauthAction = buildSelectorContextFromBlock(
      'slack',
      subBlocksFromValues({
        authMethod: 'oauth',
        credential: 'active-oauth',
        botToken: 'xoxb-dormant',
      }),
      {
        selectorKey: 'slack.channels',
        dependsOn: ['authMethod', 'credential', 'botToken'],
      }
    )
    expect(oauthAction.oauthCredential).toBe('active-oauth')

    const botAction = buildSelectorContextFromBlock(
      'slack',
      subBlocksFromValues({
        authMethod: 'bot_token',
        credential: 'dormant-oauth',
        botToken: '{{SLACK_BOT_TOKEN}}',
      }),
      {
        selectorKey: 'slack.channels',
        dependsOn: ['authMethod', 'credential', 'botToken'],
      }
    )
    expect(botAction.oauthCredential).toBe('{{SLACK_BOT_TOKEN}}')

    const trigger = buildSelectorContextFromBlock(
      'slack_v2',
      subBlocksFromValues({
        eventType: 'message',
        customBotCredential: '{{SLACK_TRIGGER_CREDENTIAL}}',
      }),
      {
        selectorKey: 'slack.channels',
        dependsOn: ['customBotCredential'],
        triggerMode: true,
      }
    )
    expect(trigger.oauthCredential).toBe('{{SLACK_TRIGGER_CREDENTIAL}}')
  })

  it('projects the optional Microsoft Excel drive cascade input', () => {
    const excel = buildSelectorContextFromBlock(
      'microsoft_excel',
      subBlocksFromValues({
        credential: 'excel-credential',
        driveId: '{{SHAREPOINT_DRIVE_ID}}',
      }),
      {
        selectorKey: 'microsoft.excel',
        dependsOn: ['credential', 'driveId'],
      }
    )
    expect(excel.driveId).toBe('{{SHAREPOINT_DRIVE_ID}}')
  })

  it('uses trigger credentials with and without canonical metadata after action conversion', () => {
    const clickupValues = {
      selectedTriggerId: 'clickup_task_created',
      credential: 'dormant-action',
      triggerCredentials: 'active-trigger',
    }
    const cases = [
      { blockType: 'clickup', values: clickupValues },
      {
        blockType: 'airtable',
        values: { credential: 'dormant-action', triggerCredentials: 'active-trigger' },
      },
    ]

    for (const { blockType, values } of cases) {
      expect(
        buildSelectorContextFromBlock(blockType, subBlocksFromValues(values), {
          triggerMode: true,
        }).oauthCredential
      ).toBe('active-trigger')
    }

    const clickupConfig = getRealBlock('clickup')
    const triggerCanonicalIndex = buildCanonicalIndex(
      getSelectorContextSubBlocks(clickupConfig?.subBlocks ?? [], clickupValues, true)
    )
    expect(resolveDependencyValue('triggerCredentials', clickupValues, triggerCanonicalIndex)).toBe(
      'active-trigger'
    )
  })

  it('uses only active trigger dependencies in the strict selector context path', () => {
    const context = buildSelectorContextFromBlock(
      'clickup',
      subBlocksFromValues({
        selectedTriggerId: 'clickup_task_created',
        credential: 'dormant-action',
        triggerCredentials: '{{CLICKUP_SHARED_CREDENTIAL}}',
        teamId: '<previous.output>',
      }),
      {
        selectorKey: 'clickup.spaces',
        dependsOn: ['triggerCredentials', 'teamId'],
        triggerMode: true,
      }
    )

    expect(context).toEqual({ oauthCredential: '{{CLICKUP_SHARED_CREDENTIAL}}' })
  })

  it('does not leak a dormant action credential when an unmapped trigger credential is blank', () => {
    const ctx = buildSelectorContextFromBlock(
      'airtable',
      subBlocksFromValues({ credential: 'dormant-action', triggerCredentials: '' }),
      { triggerMode: true }
    )

    expect(ctx.oauthCredential).toBeUndefined()
  })

  it('exposes a trigger workspace slug to the Bitbucket repository selector', () => {
    const context = buildSelectorContextFromBlock(
      'bitbucket',
      {
        selectedTriggerId: {
          id: 'selectedTriggerId',
          type: 'dropdown',
          value: 'bitbucket_push',
        },
        triggerCredentials: {
          id: 'triggerCredentials',
          type: 'oauth-input',
          value: 'credential-1',
        },
        workspacePicker: {
          id: 'workspacePicker',
          type: 'project-selector',
          value: 'acme-platform',
        },
      },
      { triggerMode: true }
    )

    expect(context).toMatchObject({
      oauthCredential: 'credential-1',
      workspaceSlug: 'acme-platform',
    })
    expect(isSelectorReady('bitbucket.repositories', context)).toBe(true)
  })

  it('should ignore subblock keys not in SELECTOR_CONTEXT_FIELDS', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      query: { id: 'query', type: 'short-input', value: 'some search query' },
    })

    expect((ctx as Record<string, unknown>).query).toBeUndefined()
    expect((ctx as Record<string, unknown>).operation).toBeUndefined()
  })
})

describe('SELECTOR_CONTEXT_FIELDS validation', () => {
  it('every entry must be a canonicalParamId (if a canonical pair exists) or a direct subblock ID', () => {
    const explicitSurfaceFields = new Set(['excludeWorkflowId'])
    const allCanonicalParamIds = new Set<string>()
    const allSubBlockIds = new Set<string>()
    const idsInCanonicalPairs = new Set<string>()

    for (const block of getAllBlocks()) {
      const index = buildCanonicalIndex(block.subBlocks)

      for (const sb of block.subBlocks) {
        allSubBlockIds.add(sb.id)
        if (sb.canonicalParamId) {
          allCanonicalParamIds.add(sb.canonicalParamId)
        }
      }

      for (const group of Object.values(index.groupsById)) {
        if (!isCanonicalPair(group)) continue
        if (group.basicId) idsInCanonicalPairs.add(group.basicId)
        for (const advId of group.advancedIds) idsInCanonicalPairs.add(advId)
      }
    }

    const errors: string[] = []

    for (const field of SELECTOR_CONTEXT_FIELDS) {
      const f = field as string
      if (explicitSurfaceFields.has(f)) continue
      if (allCanonicalParamIds.has(f)) continue

      if (idsInCanonicalPairs.has(f)) {
        errors.push(
          `"${f}" is a member subblock ID inside a canonical pair — use the canonicalParamId instead`
        )
        continue
      }

      if (!allSubBlockIds.has(f)) {
        errors.push(`"${f}" is not a canonicalParamId or subblock ID in any block definition`)
      }
    }

    if (errors.length > 0) {
      throw new Error(`SELECTOR_CONTEXT_FIELDS validation failed:\n${errors.join('\n')}`)
    }
  })
})
