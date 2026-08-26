/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { SelectorContext, SelectorDefinition } from '@/hooks/selectors/types'
import { getScopedSelectorQueryKey } from '@/hooks/selectors/use-selector-query'

const definition: SelectorDefinition = {
  key: 'jira.projects',
  serverResolvedContextFields: ['domain'],
  getQueryKey: () => ['selectors', 'synthetic.serverResolved'],
  fetchList: async () => [],
}

function scopedKey(context: SelectorContext) {
  return getScopedSelectorQueryKey(definition, {
    key: definition.key,
    context,
  })
}

describe('server-resolved selector cache scope', () => {
  it('keeps dependency revisions in separate real QueryClient entries without keying plaintext', () => {
    const queryClient = new QueryClient()
    const firstKey = scopedKey({
      domain: 'first-secret.example.com',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      selectorCacheScope: 'revision-1',
    })
    const secondKey = scopedKey({
      domain: 'second-secret.example.com',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      selectorCacheScope: 'revision-2',
    })

    queryClient.setQueryData(firstKey, ['first-result'])
    queryClient.setQueryData(secondKey, ['second-result'])

    expect(queryClient.getQueryData(firstKey)).toEqual(['first-result'])
    expect(queryClient.getQueryData(secondKey)).toEqual(['second-result'])
    expect(firstKey).not.toEqual(secondKey)
    expect(JSON.stringify([firstKey, secondKey])).not.toContain('first-secret.example.com')
    expect(JSON.stringify([firstKey, secondKey])).not.toContain('second-secret.example.com')
  })

  it('partitions identical references by workspace, workflow, and opaque dependency revision', () => {
    const firstKey = scopedKey({
      domain: '{{DOMAIN}}',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      selectorCacheScope: 'revision-1',
    })
    const otherWorkflowKey = scopedKey({
      domain: '{{DOMAIN}}',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-2',
      selectorCacheScope: 'revision-1',
    })
    const otherWorkspaceKey = scopedKey({
      domain: '{{DOMAIN}}',
      workspaceId: 'workspace-2',
      workflowId: 'workflow-1',
      selectorCacheScope: 'revision-1',
    })
    const changedDependencyKey = scopedKey({
      domain: '{{DOMAIN}}',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      selectorCacheScope: 'revision-2',
    })

    expect(
      new Set(
        [firstKey, otherWorkflowKey, otherWorkspaceKey, changedDependencyKey].map(JSON.stringify)
      )
    ).toHaveLength(4)
  })

  it('leaves non-opted selectors on their existing query keys', () => {
    const legacyDefinition: SelectorDefinition = {
      key: 'jira.projects',
      getQueryKey: () => ['selectors', 'legacy'],
      fetchList: async () => [],
    }

    expect(
      getScopedSelectorQueryKey(legacyDefinition, {
        key: legacyDefinition.key,
        context: {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          selectorCacheScope: 'revision-1',
        },
      })
    ).toEqual(['selectors', 'legacy'])
  })
})
