/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  compileCredentialGroupWorkflowAccessPolicy,
  credentialGroupWorkflowAccessPolicyCodec,
  decodeCredentialGroupKnowledgeConnectorAccess,
  decodeCredentialGroupWorkflowAccessPolicy,
  evaluateCredentialGroupKnowledgeConnectorAccess,
  evaluateCredentialGroupWorkflowAccess,
  requireDefaultCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import {
  CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
} from '@/lib/credential-groups/limits'
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

function connectorPolicy(
  knowledgeConnectorAccess: Array<{ credentialGroupOptionId: string; connectorIds: string[] }>,
  workflowIds: string[] = []
) {
  return compileCredentialGroupWorkflowAccessPolicy({
    credentialGroupId: GROUP_ID,
    allowedWorkflowIds: workflowIds,
    knowledgeConnectorAccess,
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

  describe('knowledge connector access', () => {
    it('compiles one sorted, option-conditioned statement per credential option after the workflow statement', () => {
      const document = connectorPolicy(
        [
          { credentialGroupOptionId: 'option-b', connectorIds: ['connector-2', 'connector-1'] },
          { credentialGroupOptionId: 'option-a', connectorIds: ['connector-3'] },
          { credentialGroupOptionId: 'option-empty', connectorIds: [] },
        ],
        ['workflow-1']
      )
      expect(document.statements.map((statement) => statement.sid)).toEqual([
        'CredentialGroupActorCredentialAccess',
        'WorkflowCredentialAccess',
        'KnowledgeConnectorCredentialAccess:option-a',
        'KnowledgeConnectorCredentialAccess:option-b',
      ])
      expect(document.statements[3]).toEqual({
        sid: 'KnowledgeConnectorCredentialAccess:option-b',
        effect: 'allow',
        actions: ['credential_groups.credentials.use'],
        principals: [
          { type: 'knowledge_connector', connectorId: 'connector-1' },
          { type: 'knowledge_connector', connectorId: 'connector-2' },
        ],
        condition: { StringEquals: { 'credential_group:OptionId': 'option-b' } },
      })
      expect(decodeCredentialGroupKnowledgeConnectorAccess(document, GROUP_ID)).toEqual([
        { credentialGroupOptionId: 'option-a', connectorIds: ['connector-3'] },
        { credentialGroupOptionId: 'option-b', connectorIds: ['connector-1', 'connector-2'] },
      ])
      expect(decodeCredentialGroupWorkflowAccessPolicy(document, GROUP_ID)).toEqual(['workflow-1'])
    })

    it('rejects a connector bound to two options, repeats, and oversized options', () => {
      expect(() =>
        connectorPolicy([
          { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          { credentialGroupOptionId: 'option-b', connectorIds: ['connector-1'] },
        ])
      ).toThrow('more than one credential option')
      expect(() =>
        connectorPolicy([
          { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1', 'connector-1'] },
        ])
      ).toThrow('repeats knowledge connector connector-1')
      expect(() =>
        connectorPolicy([
          { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          { credentialGroupOptionId: 'option-a', connectorIds: ['connector-2'] },
        ])
      ).toThrow('repeats credential option option-a')
      expect(() =>
        connectorPolicy([
          {
            credentialGroupOptionId: 'option-a',
            connectorIds: Array.from(
              { length: CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT + 1 },
              (_, index) => `connector-${index}`
            ),
          },
        ])
      ).toThrow(
        `more than ${CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT} knowledge connectors`
      )
    })

    it.each([
      [
        'a connector statement before the workflow statement',
        () => {
          const document = connectorPolicy(
            [{ credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] }],
            ['workflow-1']
          )
          return {
            statements: [document.statements[0], document.statements[2], document.statements[1]],
          }
        },
      ],
      [
        'unsorted option statements',
        () => {
          const document = connectorPolicy([
            { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
            { credentialGroupOptionId: 'option-b', connectorIds: ['connector-2'] },
          ])
          return {
            statements: [document.statements[0], document.statements[2], document.statements[1]],
          }
        },
      ],
      [
        'a SID naming a different option than its condition',
        () => {
          const document = connectorPolicy([
            { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          ])
          return {
            statements: [
              document.statements[0],
              { ...document.statements[1], sid: 'KnowledgeConnectorCredentialAccess:option-b' },
            ],
          }
        },
      ],
      [
        'a connector statement without an option condition',
        () => {
          const document = connectorPolicy([
            { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          ])
          return {
            statements: [
              document.statements[0],
              { ...document.statements[1], condition: undefined },
            ],
          }
        },
      ],
      [
        'a connector statement carrying a workflow principal',
        () => {
          const document = connectorPolicy([
            { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          ])
          return {
            statements: [
              document.statements[0],
              {
                ...document.statements[1],
                principals: [{ type: 'workflow', workflowId: 'workflow-1' }],
              },
            ],
          }
        },
      ],
    ])('rejects %s', (_name, replacement) => {
      const candidate = { ...policy([]), ...replacement() }
      expect(() =>
        credentialGroupWorkflowAccessPolicyCodec.parse(candidate, {
          type: 'credential_group',
          id: GROUP_ID,
        })
      ).toThrow()
    })

    it('grants exactly the named connector for exactly the conditioned option', () => {
      const document = connectorPolicy(
        [{ credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] }],
        ['workflow-1']
      )
      const decide = (connectorId: string, credentialGroupOptionId: string) =>
        evaluateCredentialGroupKnowledgeConnectorAccess({
          document,
          credentialGroupId: GROUP_ID,
          connectorId,
          credentialGroupOptionId,
          resourcePolicy: RESOURCE_POLICY,
        })
      expect(decide('connector-1', 'option-a')).toEqual({
        decision: 'allow',
        statementSid: 'KnowledgeConnectorCredentialAccess:option-a',
      })
      expect(decide('connector-1', 'option-b')).toEqual({ decision: 'implicit_deny' })
      expect(decide('connector-2', 'option-a')).toEqual({ decision: 'implicit_deny' })
    })

    it('never lets a connector statement satisfy an actor or workflow evaluation', () => {
      const document = connectorPolicy([
        { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
      ])
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
      ).toEqual({ decision: 'implicit_deny' })
    })

    it('treats connector grants as a non-default policy', () => {
      expect(() =>
        requireDefaultCredentialGroupWorkflowAccessPolicy({
          revision: 1,
          document: connectorPolicy([
            { credentialGroupOptionId: 'option-a', connectorIds: ['connector-1'] },
          ]),
          credentialGroupId: GROUP_ID,
        })
      ).toThrow('non-default')
    })
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
