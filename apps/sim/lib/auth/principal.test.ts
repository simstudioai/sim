/**
 * @vitest-environment node
 */
import {
  bindPrincipalExecutionMetadata,
  enterPrincipalWorkflowExecution,
  PrincipalSubjectUserRequiredError,
  parsePrincipal,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
  resolvePrincipalExecutionActorUserId,
  resolvePrincipalSubject,
  resolvePrincipalSubjectUserId,
  serializePrincipal,
  toPrincipalActor,
  withPrincipalExecutionActor,
} from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'

describe('principal subject users', () => {
  it('resolves the human subject represented by user-backed principals', () => {
    expect(
      requirePrincipalSubjectUserId({
        kind: 'session',
        userId: 'session-user',
        sessionId: 'session-1',
      })
    ).toBe('session-user')
    expect(
      requirePrincipalSubjectUserId({
        kind: 'personal_api_key',
        userId: 'key-user',
        keyId: 'key-1',
      })
    ).toBe('key-user')
    expect(
      requirePrincipalSubjectUserId({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'delegated-user',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:test',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toBe('delegated-user')
  })

  it('resolves the same subject without demanding one', () => {
    expect(
      resolvePrincipalSubjectUserId({
        kind: 'session',
        userId: 'session-user',
        sessionId: 'session-1',
      })
    ).toBe('session-user')
    expect(
      resolvePrincipalSubjectUserId({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'delegated-user',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:test',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toBe('delegated-user')
  })

  it('answers undefined for an actorless caller rather than throwing', () => {
    // The distinction the two helpers exist to make visible: a schedule, a webhook
    // with no external subject, and a workspace key are all authorized callers that
    // simply have no person. Attribution-only reads take this branch.
    expect(
      resolvePrincipalSubjectUserId({
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    ).toBeUndefined()
    expect(
      resolvePrincipalSubjectUserId({
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionMetadata: {
          executionId: 'execution-1',
          rootWorkflowId: 'workflow-1',
          currentWorkflow: {
            workflowId: 'workflow-1',
            mode: 'draft',
          },
        },
      })
    ).toBeUndefined()
    expect(
      resolvePrincipalSubjectUserId({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toBeUndefined()
  })

  it('resolves only a principal-bound compatibility actor for actorless execution', () => {
    const principal = withPrincipalExecutionActor(
      bindPrincipalExecutionMetadata(
        {
          kind: 'system',
          serviceId: 'public_api',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        {
          executionId: 'execution-1',
          rootWorkflowId: 'workflow-1',
          currentWorkflow: {
            workflowId: 'workflow-1',
            mode: 'deployment',
            deploymentVersionId: 'deployment-1',
          },
        }
      ),
      'execution-actor'
    )

    expect(resolvePrincipalSubjectUserId(principal)).toBeUndefined()
    expect(resolvePrincipalExecutionActorUserId(principal)).toBe('execution-actor')
    expect(
      resolvePrincipalExecutionActorUserId(
        bindPrincipalExecutionMetadata(
          { kind: 'session', userId: 'authenticated-user', sessionId: 'session-1' },
          {
            executionId: 'execution-1',
            rootWorkflowId: 'workflow-1',
            currentWorkflow: {
              workflowId: 'workflow-1',
              mode: 'deployment',
              deploymentVersionId: 'deployment-1',
            },
          }
        )
      )
    ).toBe('authenticated-user')
    expect(
      resolvePrincipalExecutionActorUserId({
        ...principal,
        executionMetadata: {
          ...principal.executionMetadata,
          currentWorkflow: {
            workflowId: 'workflow-1',
            mode: 'draft',
          },
        },
      })
    ).toBeUndefined()
  })

  it('fails fast instead of fabricating a workspace-key subject', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })

  it('fails fast instead of fabricating a Sim user for an external enrollment', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })

  it('fails fast instead of fabricating a system subject', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'system',
        serviceId: 'public_api',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })
})

describe('principal persistence', () => {
  it('round trips delegated principals and restores dates', () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
      resourceScope: { executionId: 'execution-1' },
    }

    const restored = parsePrincipal(structuredClone(serializePrincipal(principal)))

    expect(restored).toEqual(principal)
    expect(restored.kind === 'delegated' && restored.issuedAt).toBeInstanceOf(Date)
  })

  it('rejects unknown versions, fields, and invalid dates', () => {
    expect(() =>
      parsePrincipal({
        version: 2,
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      })
    ).toThrow('Serialized principal is missing executionMetadata')
    expect(() =>
      parsePrincipal({
        version: 3,
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      })
    ).toThrow('Unsupported serialized principal version')
    expect(() =>
      parsePrincipal({
        version: 1,
        principal: {
          kind: 'session',
          userId: 'user-1',
          sessionId: 'session-1',
          token: 'must-not-survive',
        },
      })
    ).toThrow('unsupported field token')
    expect(() =>
      parsePrincipal({
        version: 1,
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'delegation-1',
          audience: 'sim:workflows',
          issuedAt: 'not-a-date',
          expiresAt: '2026-01-01T00:05:00.000Z',
        },
      })
    ).toThrow('issuedAt must be an ISO timestamp')
  })

  it('does not accept Credential Group invitation principals', () => {
    expect(() =>
      parsePrincipal({
        version: 1,
        principal: {
          kind: 'credential_group_enrollment',
          workspaceId: 'workspace-1',
          credentialGroupId: 'group-1',
          enrollmentId: 'enrollment-1',
          email: 'person@example.com',
          invitationTokenHash: 'hash-1',
        },
      })
    ).toThrow('cannot be persisted')
  })

  it('round trips a verified external webhook subject', () => {
    const principal = {
      kind: 'system' as const,
      serviceId: 'webhook' as const,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'slack',
      subject: {
        kind: 'external_user' as const,
        provider: 'slack',
        tenantId: 'T123',
        subjectId: 'U123',
      },
    }

    expect(parsePrincipal(serializePrincipal(principal))).toEqual(principal)
  })

  it('changes only current workflow authority when entering a regular child', () => {
    const root = bindPrincipalExecutionMetadata(
      { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment',
          deploymentVersionId: 'root-version-1',
        },
      }
    )

    const child = enterPrincipalWorkflowExecution(root, {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'child-version-1',
    })

    expect(child).toMatchObject({
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
      executionMetadata: {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: {
          workflowId: 'child-workflow',
          mode: 'deployment',
          deploymentVersionId: 'child-version-1',
        },
      },
    })
  })

  it('rejects incomplete or cross-provider webhook identity', () => {
    expect(() =>
      parsePrincipal({
        version: 1,
        principal: {
          kind: 'system',
          serviceId: 'webhook',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
      })
    ).toThrow('require webhookId and provider')
    expect(() =>
      parsePrincipal({
        version: 1,
        principal: {
          kind: 'system',
          serviceId: 'webhook',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          webhookId: 'webhook-1',
          provider: 'slack',
          subject: {
            kind: 'external_user',
            provider: 'discord',
            tenantId: 'T123',
            subjectId: 'U123',
          },
        },
      })
    ).toThrow('subject provider must match')
  })
})

describe('principal subjects', () => {
  it('keeps Sim and external subjects distinct', () => {
    expect(
      resolvePrincipalSubject({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    ).toEqual({ kind: 'sim_user', userId: 'user-1' })
    expect(
      resolvePrincipalSubject({
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'T123',
          subjectId: 'U123',
        },
      })
    ).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T123',
      subjectId: 'U123',
    })
    expect(
      resolvePrincipalSubject({
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    ).toBeNull()
  })
})

describe('principal actors', () => {
  it('maps every principal to an audit actor without billing-owner substitution', () => {
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'session',
        userId: 'user-1',
        sessionId: 'session-1',
      })
    ).toEqual({
      actor: { kind: 'session', userId: 'user-1' },
      actorId: 'user-1',
    })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-2',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toMatchObject({ actorId: 'user-2' })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toEqual({
      actor: { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
      actorId: null,
      actorName: 'Workspace API key',
    })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toEqual({
      actor: {
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
      },
      actorId: null,
      actorName: 'person@example.com',
    })
  })

  it('projects principals into their shared actor identity', () => {
    expect(
      toPrincipalActor({ kind: 'personal_api_key', keyId: 'key-1', userId: 'user-1' })
    ).toEqual({ kind: 'personal_api_key', keyId: 'key-1', userId: 'user-1' })

    expect(
      toPrincipalActor({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toEqual({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      delegationId: 'delegation-1',
    })
  })

  it('uses the workspace billing owner for workspace-key attribution', () => {
    expect(
      resolvePrincipalAttribution(
        { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
        { workspaceBillingOwnerUserId: 'billing-owner-1' }
      )
    ).toEqual({
      actor: { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
      attributedUserId: 'billing-owner-1',
    })
  })

  it('attributes user-backed principals to their human subject', () => {
    expect(
      resolvePrincipalAttribution({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    ).toMatchObject({ attributedUserId: 'user-1' })
    expect(
      resolvePrincipalAttribution({
        kind: 'personal_api_key',
        keyId: 'key-1',
        userId: 'user-2',
      })
    ).toMatchObject({ attributedUserId: 'user-2' })
    expect(
      resolvePrincipalAttribution({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-3',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toMatchObject({ attributedUserId: 'user-3' })
  })

  it('keeps the system actor while projecting billing-only legacy attribution', () => {
    const principal = {
      kind: 'system' as const,
      serviceId: 'webhook' as const,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'generic',
      executionMetadata: {
        executionId: 'execution-1',
        rootWorkflowId: 'workflow-1',
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment' as const,
          deploymentVersionId: 'deployment-version-1',
        },
      },
    }

    expect(
      resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: 'billing-owner-1',
      })
    ).toEqual({
      actor: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'generic',
      },
      attributedUserId: 'billing-owner-1',
    })
    expect(resolvePrincipalSubject(principal)).toBeNull()
    expect(resolvePrincipalExecutionActorUserId(principal)).toBeUndefined()
  })

  it('fails fast when workspace-key attribution has no billing owner', () => {
    expect(() =>
      resolvePrincipalAttribution({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toThrow('Workspace API key attribution requires a workspace billing owner')
  })

  it('fails fast when external enrollment identity is used for user attribution', () => {
    expect(() =>
      resolvePrincipalAttribution({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })
})
