import { describe, expect, it } from 'vitest'
import { getMicrosoftDataverseRequiredScope } from '@/lib/oauth/microsoft-dataverse'
import { resolveMicrosoftDataverseCredentialPolicy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/microsoft-dataverse-policy'

const ENVIRONMENT = 'https://contoso.crm.dynamics.com'
const CANONICAL_ENVIRONMENT = 'https://contoso.api.crm.dynamics.com'

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
  it('matches a credential across documented environment and Web API host aliases', () => {
    expect(
      resolve([getMicrosoftDataverseRequiredScope(CANONICAL_ENVIRONMENT)], ENVIRONMENT)
    ).toMatchObject({
      bindingState: 'matching',
      environmentUrl: CANONICAL_ENVIRONMENT,
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
      hasInvalidEnvironment: true,
      requiredScopes: [],
      requiresSeparateCredential: false,
    })
    expect(policy.environmentUrl).toBeUndefined()
  })
})
