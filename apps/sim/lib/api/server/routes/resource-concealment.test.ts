/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  concealCrossTenantResourceError,
  type InternalErrorPolicy,
  type V2ErrorPolicy,
} from '@/lib/api/server/routes'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeErrorPolicies,
  v2KnowledgeErrorPolicies,
} from '@/lib/knowledge/api/route-policies'
import { internalTableErrorPolicies, v2TableErrorPolicies } from '@/lib/table/api/route-policies'
import {
  createInternalWorkflowErrorPolicy,
  internalWorkflowErrorPolicies,
  v2WorkflowErrorPolicies,
} from '@/lib/workflows/api/route-policies'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api/internal-error-policies'
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
  {
    domain: 'knowledge base upload',
    policy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUploadAuthorization,
    notFoundMessage: 'Knowledge base not found',
  },
  {
    domain: 'knowledge base search',
    policy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUsageAuthorization,
    notFoundMessage: 'Knowledge base not found',
  },
  {
    domain: 'file upload',
    policy: v2FileErrorPolicies.concealUploadAuthorization,
    notFoundMessage: 'Upload session not found',
  },
]

const crossTenantAuthorizationErrors = [
  new NoWorkspaceAccessError(),
  new WorkspaceApiKeyScopeAuthorizationError(),
  new DelegatedWorkspaceAuthorizationError(),
]

describe.each(policies)('$domain resource concealment', ({ policy, notFoundMessage }) => {
  it.each(crossTenantAuthorizationErrors)(
    'conceals cross-tenant authorization: %s',
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
        details: { code: 'PERSONAL_API_KEYS_DISABLED' },
      },
    })
  })

  it('preserves insufficient workspace role as forbidden', async () => {
    const response = policy.render(new InsufficientWorkspacePermissionsError())
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient workspace permissions',
        details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' },
      },
    })
  })

  /**
   * The two denials above share one status and, for the role case, the exact
   * message a caller with no access at all would see. `details.code` is the
   * only thing that separates "raise this member's role" from "this workspace
   * refuses personal keys", so it is asserted rather than matched loosely.
   */
  it.each([
    [new WorkspaceApiKeyAuthorizationError(), 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED'],
    [
      new PrincipalKindAuthorizationError('workspace_api_key', 'resources.read'),
      'PRINCIPAL_KIND_NOT_PERMITTED',
    ],
  ])(
    'preserves same-workspace principal policy denial as forbidden with its cause: %s',
    async (error, detailCode) => {
      const response = policy.render(error)
      expect(response?.status).toBe(403)
      await expect(response?.json()).resolves.toMatchObject({
        error: { code: 'FORBIDDEN', details: { code: detailCode } },
      })
    }
  )

  /**
   * A cross-tenant refusal is concealed as 404, so it never reaches this
   * branch — and it carries no `details.code` for the same reason, which is
   * what stops the concealed case from being distinguishable if it ever did.
   */
  it('leaves a forbidden failure with no named cause without a details code', async () => {
    const response = policy.render(new OrchestrationError('forbidden', 'Nope'))
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'Nope' },
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

/**
 * Internal routes reach the same application use cases as their v2 twins, so a
 * cross-tenant denial must read as absence on both surfaces. Anything narrower
 * — a same-workspace role or key-policy denial — stays a 403 here exactly as it
 * does on v2.
 */
const internalPolicies: Array<{
  route: string
  policy: InternalErrorPolicy
  notFoundMessage: string
}> = [
  {
    route: 'PATCH/DELETE /api/workspaces/[id]/files/[fileId]',
    policy: internalFileErrorPolicies.concealResourceAuthorization,
    notFoundMessage: 'File not found',
  },
  {
    route: 'PUT /api/workspaces/[id]/files/[fileId]/content',
    policy: internalFileErrorPolicies.concealContentAuthorization,
    notFoundMessage: 'File not found',
  },
  {
    route: 'GET/DELETE /api/workflows/[id]',
    policy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
    notFoundMessage: 'Workflow not found',
  },
  {
    route: 'POST/DELETE /api/workflows/[id]/deploy',
    policy: createInternalWorkflowErrorPolicy('Failed to deploy workflow'),
    notFoundMessage: 'Workflow not found',
  },
  {
    route: 'GET /api/workflows/[id]/deployments',
    policy: createInternalWorkflowErrorPolicy('Failed to list deployments'),
    notFoundMessage: 'Workflow not found',
  },
  {
    route: 'GET /api/workflows/[id]/deployments/[version]',
    policy: createInternalWorkflowErrorPolicy('Failed to fetch deployment version'),
    notFoundMessage: 'Workflow not found',
  },
  {
    route: 'POST /api/table/imports, POST /api/table/[tableId]/exports',
    policy: internalTableErrorPolicies.concealTableAuthorization,
    notFoundMessage: 'Table not found',
  },
  {
    route: 'POST/PATCH/DELETE /api/table/[tableId]/groups',
    policy: internalTableErrorPolicies.concealTableGroupAuthorization,
    notFoundMessage: 'Table not found',
  },
  {
    route: 'GET/DELETE /api/table/imports/[importId]',
    policy: internalTableErrorPolicies.concealImportAuthorization,
    notFoundMessage: 'Table import not found',
  },
  {
    route: 'GET/DELETE /api/table/exports/[exportId]',
    policy: internalTableErrorPolicies.concealExportAuthorization,
    notFoundMessage: 'Table export not found',
  },
  {
    route: 'GET/PUT/DELETE /api/knowledge/[id]',
    policy: internalKnowledgeErrorPolicies.read,
    notFoundMessage: 'Knowledge base not found',
  },
  {
    route: 'GET /api/knowledge/[id]/documents/[documentId]',
    policy: internalKnowledgeErrorPolicies.documents,
    notFoundMessage: 'Knowledge base not found',
  },
  {
    route: 'POST /api/knowledge/[id]/documents',
    policy: internalKnowledgeErrorPolicies.uploads,
    notFoundMessage: 'Knowledge base not found',
  },
  {
    route: 'POST /api/knowledge/search',
    policy: internalKnowledgeErrorPolicies.search,
    notFoundMessage: 'Knowledge base not found',
  },
]

describe.each(internalPolicies)('$route internal concealment', ({ policy, notFoundMessage }) => {
  it.each(crossTenantAuthorizationErrors)('conceals cross-tenant authorization: %s', (error) => {
    const response = policy.project(error)
    expect(response?.status).toBe(404)
    expect(response?.body).toMatchObject({ error: notFoundMessage })
  })

  it('preserves insufficient workspace role as forbidden', () => {
    const response = policy.project(new InsufficientWorkspacePermissionsError())
    expect(response?.status).toBe(403)
    expect(response?.body).toMatchObject({ error: 'Insufficient workspace permissions' })
  })

  it.each([
    new PersonalApiKeysDisabledError(),
    new WorkspaceApiKeyAuthorizationError(),
    new PrincipalKindAuthorizationError('workspace_api_key', 'resources.read'),
  ])('preserves same-workspace principal policy denial as forbidden: %s', (error) => {
    expect(policy.project(error)?.status).toBe(403)
  })

  it('does not classify generic forbidden errors by message', () => {
    const response = policy.project(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
    expect(response?.status).toBe(403)
  })
})

describe('internal list surfaces', () => {
  it.each(crossTenantAuthorizationErrors)(
    'leaves workspace-level knowledge listing forbidden: %s',
    (error) => {
      expect(internalKnowledgeErrorPolicies.list.project(error)?.status).toBe(403)
      expect(internalKnowledgeErrorPolicies.create.project(error)?.status).toBe(403)
    }
  )
})

describe('concealCrossTenantResourceError', () => {
  it.each(crossTenantAuthorizationErrors)('reports absence for %s', (error) => {
    const concealed = concealCrossTenantResourceError(error, 'Workflow not found')
    expect(asOrchestrationError(concealed)).toMatchObject({
      code: 'not_found',
      message: 'Workflow not found',
    })
  })

  it('passes every other failure through untouched', () => {
    const error = new InsufficientWorkspacePermissionsError()
    expect(concealCrossTenantResourceError(error, 'Workflow not found')).toBe(error)
  })
})
