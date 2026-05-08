/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  flattenWorkflowSearchReplacementOptions,
  workflowSearchReplaceKeys,
} from '@/hooks/queries/workflow-search-replace'

describe('workflowSearchReplaceKeys', () => {
  it('builds stable hierarchical keys for credential candidates', () => {
    expect(
      workflowSearchReplaceKeys.oauthReplacementOptions('gmail', 'workspace-1', 'workflow-1')
    ).toEqual([
      'workflow-search-replace',
      'replacement-options',
      'oauth',
      'gmail',
      'workspace-1',
      'workflow-1',
    ])
  })

  it('builds scoped selector replacement option keys', () => {
    expect(
      workflowSearchReplaceKeys.selectorReplacementOptions(
        'gmail.labels',
        '{"oauthCredential":"credential-1","workspaceId":"workspace-1"}'
      )
    ).toEqual([
      'workflow-search-replace',
      'replacement-options',
      'selector',
      'gmail.labels',
      '{"oauthCredential":"credential-1","workspaceId":"workspace-1"}',
    ])
  })
})

describe('flattenWorkflowSearchReplacementOptions', () => {
  it('flattens loaded option groups while ignoring pending groups', () => {
    expect(
      flattenWorkflowSearchReplacementOptions([
        { data: [{ kind: 'environment', value: '{{A}}', label: '{{A}}' }] },
        {},
        { data: [{ kind: 'knowledge-base', value: 'kb-1', label: 'KB 1' }] },
      ])
    ).toEqual([
      { kind: 'environment', value: '{{A}}', label: '{{A}}' },
      { kind: 'knowledge-base', value: 'kb-1', label: 'KB 1' },
    ])
  })
})
