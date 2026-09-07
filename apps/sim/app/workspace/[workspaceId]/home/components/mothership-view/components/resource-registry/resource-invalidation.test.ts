/** @vitest-environment node */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry/resource-invalidation'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { connectorDocumentKeys, connectorKeys } from '@/hooks/queries/kb/connectors'
import { logKeys } from '@/hooks/queries/logs'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

describe('resource cache reconciliation', () => {
  it('refreshes table rows, schema and saved views without expiring another table', () => {
    const client = new QueryClient()
    const affected = [
      tableKeys.detail('t'),
      tableKeys.views('t'),
      tableKeys.infiniteRows('t', 'filter'),
    ]
    for (const key of [...affected, tableKeys.views('other')]) client.setQueryData(key, {})
    invalidateResourceQueries(client, 'w', 'table', 't')
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(tableKeys.views('other'))?.isInvalidated).toBe(false)
  })

  it('covers knowledge documents, chunks, tags and connectors through the parent key', () => {
    const client = new QueryClient()
    const affected = [
      knowledgeKeys.documents('kb', 'page'),
      knowledgeKeys.chunks('kb', 'document', 'page'),
      knowledgeKeys.tagDefinitions('kb'),
      connectorKeys.detail('kb', 'connector'),
      connectorDocumentKeys.list('kb', 'connector', true),
    ]
    for (const key of affected) client.setQueryData(key, {})
    invalidateResourceQueries(client, 'w', 'knowledgebase', 'kb')
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('invalidates stored workflow state and file contents, including collection refreshes', () => {
    const client = new QueryClient()
    const workflow = workflowKeys.state('wf')
    const file = workspaceFilesKeys.contentFile('w', 'file')
    client.setQueryData(workflow, {})
    client.setQueryData(file, {})
    invalidateResourceQueries(client, 'w', 'workflow', 'wf')
    invalidateResourceQueries(client, 'w', 'file')
    expect(client.getQueryState(workflow)?.isInvalidated).toBe(true)
    expect(client.getQueryState(file)?.isInvalidated).toBe(true)
  })

  it('updates workflow publication metadata shown beside the draft', () => {
    const client = new QueryClient()
    const affected = [
      deploymentKeys.info('wf'),
      deploymentKeys.deployedState('wf'),
      deploymentKeys.versions('wf'),
      deploymentKeys.chatStatus('wf'),
    ]
    for (const key of affected) client.setQueryData(key, {})
    invalidateResourceQueries(client, 'w', 'workflow', 'wf')
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('refreshes every folder family and both task navigation scopes', () => {
    const client = new QueryClient()
    const affected = [
      folderKeys.list('w', 'active', 'workflow'),
      folderKeys.list('w', 'active', 'table'),
      folderKeys.list('w', 'archived', 'knowledge_base'),
      mothershipChatKeys.list('w', 'active'),
      mothershipChatKeys.list('w', 'archived'),
      mothershipChatKeys.detail('chat'),
    ]
    for (const key of affected) client.setQueryData(key, {})
    invalidateResourceQueries(client, 'w', 'folder')
    invalidateResourceQueries(client, 'w', 'task', 'chat')
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('leaves desktop and ephemeral panels under their existing owners', () => {
    const client = new QueryClient()
    client.setQueryData(tableKeys.detail('t'), {})
    for (const type of ['browser', 'terminal', 'generic'] as const)
      invalidateResourceQueries(client, 'w', type)
    expect(client.getQueryState(tableKeys.detail('t'))?.isInvalidated).toBe(false)
  })

  it('refreshes log navigation and execution lookup while preserving other workspaces', () => {
    const client = new QueryClient()
    const affected = [
      [...logKeys.lists(), 'w', { workflowIds: ['workflow'] }],
      logKeys.stat('w', {}),
      logKeys.detail('w', 'row'),
      logKeys.byExecution('w', 'execution'),
    ]
    const unrelated = [logKeys.detail('other', 'row'), logKeys.byExecution('other', 'execution')]
    for (const key of [...affected, ...unrelated]) client.setQueryData(key, {})
    invalidateResourceQueries(client, 'w', 'log', 'row')
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  })
})
