/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getMicrosoftDataverseRequiredScope } from '@/lib/oauth/microsoft-dataverse'
import { resolveMicrosoftDataverseCredentialPolicy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/microsoft-dataverse-policy'

const ENVIRONMENT = 'https://contoso.crm.dynamics.com'

function resolve(scopes?: string[], environmentUrl: unknown = ENVIRONMENT) {
  return resolveMicrosoftDataverseCredentialPolicy({
    dependsOn: ['environmentUrl'],
    environmentUrl,
    hasSelectedCredential: scopes !== undefined,
    providerId: 'microsoft-dataverse',
    selectedCredentialScopes: scopes,
  })
}

describe('resolveMicrosoftDataverseCredentialPolicy', () => {
  it('does not apply to ordinary providers or the released Dataverse block', () => {
    expect(
      resolveMicrosoftDataverseCredentialPolicy({
        dependsOn: [],
        environmentUrl: ENVIRONMENT,
        hasSelectedCredential: true,
        providerId: 'microsoft-dataverse',
        selectedCredentialScopes: [],
      })
    ).toMatchObject({ applies: false, requiresSeparateCredential: false })
    expect(
      resolveMicrosoftDataverseCredentialPolicy({
        dependsOn: ['environmentUrl'],
        environmentUrl: ENVIRONMENT,
        hasSelectedCredential: true,
        providerId: 'salesforce',
        selectedCredentialScopes: [],
      })
    ).toMatchObject({ applies: false, requiresSeparateCredential: false })
  })

  it('accepts a credential bound to the selected environment', () => {
    expect(resolve([getMicrosoftDataverseRequiredScope(ENVIRONMENT)])).toMatchObject({
      applies: true,
      bindingState: 'matching',
      environmentUrl: ENVIRONMENT,
      requiredScopes: [getMicrosoftDataverseRequiredScope(ENVIRONMENT)],
      requiresSeparateCredential: false,
    })
  })

  it.each([
    ['legacy', ['https://dynamics.microsoft.com/user_impersonation'], 'unbound'],
    [
      'different environment',
      [getMicrosoftDataverseRequiredScope('https://other.crm.dynamics.com')],
      'different',
    ],
    [
      'ambiguous',
      [
        getMicrosoftDataverseRequiredScope(ENVIRONMENT),
        getMicrosoftDataverseRequiredScope('https://other.crm.dynamics.com'),
      ],
      'invalid',
    ],
  ])('requires a separate credential for a %s binding', (_label, scopes, bindingState) => {
    expect(resolve(scopes)).toMatchObject({
      actionLabel: 'Connect matching account',
      bindingState,
      requiresSeparateCredential: true,
    })
  })

  it('fails closed on an invalid requested environment without a credential', () => {
    const policy = resolve(undefined, 'https://evil.example')
    expect(policy).toMatchObject({
      applies: true,
      bindingState: null,
      requiredScopes: [],
      requiresSeparateCredential: false,
    })
    expect(policy.environmentUrl).toBeUndefined()
  })
})
