/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  compileCredentialGroupWorkflowAccessPolicy,
  credentialGroupWorkflowAccessPolicyCodec,
  decodeCredentialGroupWorkflowAccessPolicy,
  evaluateCredentialGroupWorkflowAccess,
  requireDefaultCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import { CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT } from '@/lib/credential-groups/limits'
import type { ResourcePolicyBindingFor } from '@/lib/resource-policies/registry'

const GROUP_ID = 'group-1'
const RESOURCE_POLICY = {
  resourceType: 'credential_group',
  action: 'credential_groups.credentials.use',
} as const satisfies ResourcePolicyBindingFor<'credential_group'>

function policy(workflowIds: string[]) {
  return compileCredentialGroupWorkflowAccessPolicy({
    credentialGroupId: GROUP_ID,
    allowedWorkflowIds: workflowIds,
  })
}

describe('Credential Group workflow access policy', () => {
  it('compiles actor ownership plus one deterministic deployment-only workflow statement', () => {
    expect(policy(['workflow-2', 'workflow-1'])).toEqual({
      version: 1,
      resource: { type: 'credential_group', id: GROUP_ID },
      statements: [
        {
          sid: 'CredentialGroupActorCredentialAccess',
          effect: 'allow',
          actions: ['credential_groups.credentials.use'],
          principals: [{ type: 'credential_group_actor' }],
          condition: {
            Bool: { 'credential_group:ActorOwnsCredential': true },
          },
        },
        {
          sid: 'WorkflowCredentialAccess',
          effect: 'allow',
          actions: ['credential_groups.credentials.use'],
          principals: [
            { type: 'workflow', workflowId: 'workflow-1' },
            { type: 'workflow', workflowId: 'workflow-2' },
          ],
          condition: { StringEquals: { 'execution:WorkflowMode': 'deployment' } },
        },
      ],
    })
    expect(policy([]).statements).toEqual([
      {
        sid: 'CredentialGroupActorCredentialAccess',
        effect: 'allow',
        actions: ['credential_groups.credentials.use'],
        principals: [{ type: 'credential_group_actor' }],
        condition: {
          Bool: { 'credential_group:ActorOwnsCredential': true },
        },
      },
    ])
  })

  it('rejects malformed workflow selections instead of normalizing them', () => {
    expect(() => policy(['workflow-1', 'workflow-1'])).toThrow('repeats workflow workflow-1')
    expect(() => policy([' workflow-1'])).toThrow('canonical non-empty strings')
    expect(() =>
      policy(
        Array.from(
          { length: CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT + 1 },
          (_, index) => `workflow-${index}`
        )
      )
    ).toThrow(`cannot allow more than ${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} workflows`)
  })

  it('decodes only the exact canonical document', () => {
    const document = policy(['workflow-2', 'workflow-1'])
    expect(decodeCredentialGroupWorkflowAccessPolicy(document, GROUP_ID)).toEqual([
      'workflow-1',
      'workflow-2',
    ])
    expect(() => decodeCredentialGroupWorkflowAccessPolicy(document, 'group-2')).toThrow(
      'does not match its canonical resource'
    )
  })

  it.each([
    ['a missing actor statement', { statements: [] }],
    ['a workflow-only document', { statements: [policy(['workflow-1']).statements[1]] }],
    [
      'multiple workflow statements',
      {
        statements: [
          policy([]).statements[0],
          policy(['workflow-1']).statements[1],
          policy(['workflow-2']).statements[1],
        ],
      },
    ],
    [
      'a different actor SID',
      { statements: [{ ...policy([]).statements[0], sid: 'OlderActorGrant' }] },
    ],
    [
      'a different actor condition',
      {
        statements: [
          {
            ...policy([]).statements[0],
            condition: { Bool: { 'credential_group:ActorOwnsCredential': false } },
          },
        ],
      },
    ],
    [
      'a different SID',
      {
        statements: [
          policy([]).statements[0],
          { ...policy(['workflow-1']).statements[1], sid: 'OlderGrant' },
        ],
      },
    ],
    [
      'a deny',
      {
        statements: [
          policy([]).statements[0],
          { ...policy(['workflow-1']).statements[1], effect: 'deny' },
        ],
      },
    ],
    [
      'another action',
      {
        statements: [
          policy([]).statements[0],
          { ...policy(['workflow-1']).statements[1], actions: ['other'] },
        ],
      },
    ],
    [
      'a non-workflow principal',
      {
        statements: [
          policy([]).statements[0],
          {
            ...policy(['workflow-1']).statements[1],
            principals: [{ type: 'user', userId: 'user-1' }],
          },
        ],
      },
    ],
    [
      'a non-scalar deployment condition',
      {
        statements: [
          policy([]).statements[0],
          {
            ...policy(['workflow-1']).statements[1],
            condition: { StringEquals: { 'execution:WorkflowMode': ['deployment'] } },
          },
        ],
      },
    ],
    [
      'unsorted workflow principals',
      {
        statements: [
          policy([]).statements[0],
          {
            ...policy(['workflow-1']).statements[1],
            principals: [
              { type: 'workflow', workflowId: 'workflow-2' },
              { type: 'workflow', workflowId: 'workflow-1' },
            ],
          },
        ],
      },
    ],
  ])('rejects %s', (_name, replacement) => {
    const candidate = { ...policy([]), ...replacement }
    expect(() =>
      credentialGroupWorkflowAccessPolicyCodec.parse(candidate, {
        type: 'credential_group',
        id: GROUP_ID,
      })
    ).toThrow()
  })

  it('requires the trigger-created policy to be revision one with only actor access', () => {
    expect(() =>
      requireDefaultCredentialGroupWorkflowAccessPolicy({
        revision: 1,
        document: policy([]),
        credentialGroupId: GROUP_ID,
      })
    ).not.toThrow()
    expect(() =>
      requireDefaultCredentialGroupWorkflowAccessPolicy({
        revision: 2,
        document: policy([]),
        credentialGroupId: GROUP_ID,
      })
    ).toThrow('non-default')
    expect(() =>
      requireDefaultCredentialGroupWorkflowAccessPolicy({
        revision: 1,
        document: policy(['workflow-1']),
        credentialGroupId: GROUP_ID,
      })
    ).toThrow('non-default')
  })

  it('evaluates actor ownership and deployed workflow access through registered statements', () => {
    const document = policy(['workflow-1'])
    expect(
      evaluateCredentialGroupWorkflowAccess({
        document,
        credentialGroupId: GROUP_ID,
        selectedEnrollmentId: 'enrollment-1',
        actorEnrollmentId: 'enrollment-1',
        currentWorkflow: { workflowId: 'workflow-2', mode: 'draft' },
        resourcePolicy: RESOURCE_POLICY,
      })
    ).toEqual({
      decision: 'allow',
      statementSid: 'CredentialGroupActorCredentialAccess',
    })
    expect(
      evaluateCredentialGroupWorkflowAccess({
        document,
        credentialGroupId: GROUP_ID,
        selectedEnrollmentId: 'enrollment-2',
        actorEnrollmentId: 'enrollment-1',
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment',
          deploymentVersionId: 'version-1',
        },
        resourcePolicy: RESOURCE_POLICY,
      })
    ).toEqual({ decision: 'allow', statementSid: 'WorkflowCredentialAccess' })
    expect(
      evaluateCredentialGroupWorkflowAccess({
        document,
        credentialGroupId: GROUP_ID,
        selectedEnrollmentId: 'enrollment-2',
        actorEnrollmentId: 'enrollment-1',
        currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
        resourcePolicy: RESOURCE_POLICY,
      })
    ).toEqual({ decision: 'implicit_deny' })
    expect(
      evaluateCredentialGroupWorkflowAccess({
        document,
        credentialGroupId: GROUP_ID,
        selectedEnrollmentId: 'enrollment-2',
        currentWorkflow: {
          workflowId: 'workflow-2',
          mode: 'deployment',
          deploymentVersionId: 'version-2',
        },
        resourcePolicy: RESOURCE_POLICY,
      })
    ).toEqual({ decision: 'implicit_deny' })
  })
})
