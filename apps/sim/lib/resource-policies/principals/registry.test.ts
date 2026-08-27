/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  matchResourcePolicyPrincipal,
  RESOURCE_POLICY_PRINCIPAL_DEFINITIONS,
  requireResourcePolicyPrincipalDefinition,
} from '@/lib/resource-policies/principals'

describe('resource policy principal registry', () => {
  it('registers the internal Credential Group actor principal', () => {
    expect(RESOURCE_POLICY_PRINCIPAL_DEFINITIONS.credential_group_actor.selector).toEqual({
      type: 'internal',
    })
    expect(
      matchResourcePolicyPrincipal(
        { type: 'credential_group_actor' },
        { credentialGroupActorEnrollmentId: 'enrollment-1' }
      )
    ).toBe(true)
    expect(matchResourcePolicyPrincipal({ type: 'credential_group_actor' }, {})).toBe(false)
  })

  it('registers workflow matching and its catalog selector together', () => {
    expect(RESOURCE_POLICY_PRINCIPAL_DEFINITIONS.workflow.selector).toEqual({
      type: 'catalog',
      catalog: 'workflows',
    })
    expect(
      matchResourcePolicyPrincipal(
        { type: 'workflow', workflowId: 'workflow-1' },
        { currentWorkflow: { workflowId: 'workflow-1', mode: 'deployment' } }
      )
    ).toBe(true)
    expect(
      matchResourcePolicyPrincipal(
        { type: 'workflow', workflowId: 'workflow-1' },
        { currentWorkflow: { workflowId: 'workflow-2', mode: 'deployment' } }
      )
    ).toBe(false)
  })

  it('fails fast for an unregistered principal type', () => {
    expect(() => requireResourcePolicyPrincipalDefinition('user')).toThrow(
      'Resource policy principal type user is not registered'
    )
  })
})
