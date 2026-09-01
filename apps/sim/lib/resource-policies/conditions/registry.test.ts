/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  RESOURCE_POLICY_CONDITION_DEFINITIONS,
  requireResourcePolicyConditionDefinition,
} from '@/lib/resource-policies/conditions'

describe('resource policy condition registry', () => {
  it('registers workflow mode resolution and selector metadata together', () => {
    const definition = RESOURCE_POLICY_CONDITION_DEFINITIONS['execution:WorkflowMode']
    expect(definition.operators).toEqual(['StringEquals'])
    expect(definition.selector).toEqual({
      type: 'static',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'deployment', label: 'Deployed' },
      ],
    })
    expect(
      definition.resolve({
        currentWorkflow: { workflowId: 'workflow-1', mode: 'deployment' },
      })
    ).toBe('deployment')
  })

  it('registers Credential Group actor ownership as an internal Boolean fact', () => {
    const definition = RESOURCE_POLICY_CONDITION_DEFINITIONS['credential_group:ActorOwnsCredential']
    expect(definition.valueType).toBe('boolean')
    expect(definition.operators).toEqual(['Bool'])
    expect(definition.selector).toEqual({ type: 'internal' })
    expect(
      definition.resolve({
        credentialGroupActorEnrollmentId: 'enrollment-1',
        credentialGroupCredentialEnrollmentId: 'enrollment-1',
      })
    ).toBe(true)
    expect(
      definition.resolve({
        credentialGroupActorEnrollmentId: 'enrollment-1',
        credentialGroupCredentialEnrollmentId: 'enrollment-2',
      })
    ).toBe(false)
    expect(definition.resolve({ credentialGroupCredentialEnrollmentId: 'enrollment-1' })).toBe(
      undefined
    )
  })

  it('fails fast for an unregistered condition key', () => {
    expect(() => requireResourcePolicyConditionDefinition('execution:Unknown')).toThrow(
      'Resource policy condition key execution:Unknown is not registered'
    )
  })
})
