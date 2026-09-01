/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { evaluateResourcePolicy } from '@/lib/resource-policies/evaluator'
import type { ResourcePolicyDocument, ResourcePolicyStatement } from '@/lib/resource-policies/types'

const ALLOW: ResourcePolicyStatement = {
  sid: 'AllowWorkflow',
  effect: 'allow',
  actions: ['credential_groups.credentials.use'],
  principals: [{ type: 'workflow', workflowId: 'workflow-1' }],
  condition: { StringEquals: { 'execution:WorkflowMode': 'deployment' } },
}

const ACTOR_ALLOW: ResourcePolicyStatement = {
  sid: 'AllowActorCredential',
  effect: 'allow',
  actions: ['credential_groups.credentials.use'],
  principals: [{ type: 'credential_group_actor' }],
  condition: { Bool: { 'credential_group:ActorOwnsCredential': true } },
}

function document(
  statements: readonly ResourcePolicyStatement[]
): ResourcePolicyDocument<'credential_group'> {
  return {
    version: 1,
    resource: { type: 'credential_group', id: 'group-1' },
    statements,
  }
}

describe('resource policy evaluator', () => {
  it('matches registered principals and conditions', () => {
    expect(
      evaluateResourcePolicy({
        document: document([ALLOW]),
        action: 'credential_groups.credentials.use',
        facts: { currentWorkflow: { workflowId: 'workflow-1', mode: 'deployment' } },
      })
    ).toEqual({ decision: 'allow', statementSid: 'AllowWorkflow' })
    expect(
      evaluateResourcePolicy({
        document: document([ALLOW]),
        action: 'credential_groups.credentials.use',
        facts: { currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' } },
      })
    ).toEqual({ decision: 'implicit_deny' })
  })

  it('matches a Credential Group actor only against their own credential', () => {
    expect(
      evaluateResourcePolicy({
        document: document([ACTOR_ALLOW]),
        action: 'credential_groups.credentials.use',
        facts: {
          credentialGroupActorEnrollmentId: 'enrollment-1',
          credentialGroupCredentialEnrollmentId: 'enrollment-1',
        },
      })
    ).toEqual({ decision: 'allow', statementSid: 'AllowActorCredential' })
    expect(
      evaluateResourcePolicy({
        document: document([ACTOR_ALLOW]),
        action: 'credential_groups.credentials.use',
        facts: {
          credentialGroupActorEnrollmentId: 'enrollment-1',
          credentialGroupCredentialEnrollmentId: 'enrollment-2',
        },
      })
    ).toEqual({ decision: 'implicit_deny' })
  })

  it('gives matching denies precedence over allows', () => {
    expect(
      evaluateResourcePolicy({
        document: document([{ ...ALLOW, sid: 'DenyWorkflow', effect: 'deny' }, ALLOW]),
        action: 'credential_groups.credentials.use',
        facts: { currentWorkflow: { workflowId: 'workflow-1', mode: 'deployment' } },
      })
    ).toEqual({ decision: 'deny', statementSid: 'DenyWorkflow' })
  })

  it('fails fast on an empty condition', () => {
    expect(() =>
      evaluateResourcePolicy({
        document: document([{ ...ALLOW, condition: {} }]),
        action: 'credential_groups.credentials.use',
        facts: { currentWorkflow: { workflowId: 'workflow-1', mode: 'deployment' } },
      })
    ).toThrow('condition must not be empty')
  })
})
