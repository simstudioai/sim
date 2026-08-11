/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { V2ErrorPolicy } from '@/lib/api/server/routes'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { v2TableErrorPolicies } from '@/lib/table/api/route-policies'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api/route-policies'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api/route-policies'

const policies: Array<{
  domain: string
  policy: V2ErrorPolicy
  notFoundMessage: string
}> = [
  {
    domain: 'file',
    policy: v2FileErrorPolicies.concealResourceAuthorization,
    notFoundMessage: 'File not found',
  },
  {
    domain: 'workflow',
    policy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
    notFoundMessage: 'Workflow not found',
  },
  {
    domain: 'workflow run',
    policy: v2WorkflowErrorPolicies.concealRunAuthorization,
    notFoundMessage: 'Run not found',
  },
  {
    domain: 'table',
    policy: v2TableErrorPolicies.concealTableAuthorization,
    notFoundMessage: 'Table not found',
  },
  {
    domain: 'table import',
    policy: v2TableErrorPolicies.concealImportAuthorization,
    notFoundMessage: 'Table import not found',
  },
  {
    domain: 'table export',
    policy: v2TableErrorPolicies.concealExportAuthorization,
    notFoundMessage: 'Table export not found',
  },
  {
    domain: 'knowledge base',
    policy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
    notFoundMessage: 'Knowledge base not found',
  },
]

const resourceAuthorizationErrors = [
  new NoWorkspaceAccessError(),
  new WorkspaceApiKeyAuthorizationError(),
  new DelegatedWorkspaceAuthorizationError(),
  new PrincipalKindAuthorizationError('workspace_api_key', 'resources.read'),
]

describe.each(policies)('$domain resource concealment', ({ policy, notFoundMessage }) => {
  it.each(resourceAuthorizationErrors)(
    'conceals typed resource authorization: %s',
    async (error) => {
      const response = policy.render(error)
      expect(response?.status).toBe(404)
      await expect(response?.json()).resolves.toEqual({
        error: { code: 'NOT_FOUND', message: notFoundMessage },
      })
    }
  )

  it('preserves workspace personal-key policy denial as forbidden', async () => {
    const response = policy.render(new PersonalApiKeysDisabledError())
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
      },
    })
  })

  it('preserves insufficient workspace role as forbidden', async () => {
    const response = policy.render(new InsufficientWorkspacePermissionsError())
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Insufficient workspace permissions' },
    })
  })

  it('does not classify generic forbidden errors by message', async () => {
    const response = policy.render(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Insufficient workspace permissions' },
    })
  })
})
