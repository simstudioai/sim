import {
  classifyMicrosoftDataverseCredentialEnvironment,
  getMicrosoftDataverseRequiredScope,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
  type MicrosoftDataverseCredentialEnvironmentState,
  normalizeMicrosoftDataverseEnvironmentUrl,
} from '@/lib/oauth/microsoft-dataverse'

interface ResolveMicrosoftDataverseCredentialPolicyParams {
  dependsOn: readonly string[]
  environmentUrl: unknown
  hasSelectedCredential: boolean
  providerId: string
  selectedCredentialScopes?: readonly string[]
}

export interface MicrosoftDataverseCredentialPolicy {
  actionLabel: string
  applies: boolean
  bindingState: MicrosoftDataverseCredentialEnvironmentState | null
  environmentUrl?: string
  message: string
  requiredScopes: string[]
  requiresSeparateCredential: boolean
}

const DEFAULT_POLICY: MicrosoftDataverseCredentialPolicy = {
  actionLabel: 'Update access',
  applies: false,
  bindingState: null,
  message: 'Additional permissions required',
  requiredScopes: [],
  requiresSeparateCredential: false,
}

export function resolveMicrosoftDataverseCredentialPolicy({
  dependsOn,
  environmentUrl,
  hasSelectedCredential,
  providerId,
  selectedCredentialScopes,
}: ResolveMicrosoftDataverseCredentialPolicyParams): MicrosoftDataverseCredentialPolicy {
  const applies =
    providerId === MICROSOFT_DATAVERSE_PROVIDER_ID && dependsOn.includes('environmentUrl')
  if (!applies) return DEFAULT_POLICY

  let normalizedEnvironmentUrl: string
  try {
    normalizedEnvironmentUrl = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
  } catch {
    return {
      ...DEFAULT_POLICY,
      applies: true,
      bindingState: hasSelectedCredential ? 'invalid' : null,
      message: 'Enter a valid Dynamics environment before selecting a credential',
    }
  }

  const requiredScopes = [getMicrosoftDataverseRequiredScope(normalizedEnvironmentUrl)]
  const bindingState = hasSelectedCredential
    ? classifyMicrosoftDataverseCredentialEnvironment(
        selectedCredentialScopes,
        normalizedEnvironmentUrl
      )
    : null
  const requiresSeparateCredential =
    bindingState === 'unbound' || bindingState === 'different' || bindingState === 'invalid'

  return {
    actionLabel: requiresSeparateCredential ? 'Connect matching account' : 'Update access',
    applies: true,
    bindingState,
    environmentUrl: normalizedEnvironmentUrl,
    message: requiresSeparateCredential
      ? 'This credential is not connected to this Dynamics environment'
      : 'Additional permissions required',
    requiredScopes,
    requiresSeparateCredential,
  }
}
