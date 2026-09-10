import type {
  OrganizationAccountsSettings,
  UpdateOrganizationAccountsBody,
} from '@/lib/api/contracts/organization-accounts'

/** Preserves option identities and custom Slack scopes while the server refreshes managed OAuth policies. */
export function getOrganizationAccountUpdateOptions(
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
): NonNullable<UpdateOrganizationAccountsBody['options']> {
  return group.options.map((option) => {
    const common = { id: option.id, label: option.label, required: option.required }
    return option.provider === 'slack'
      ? {
          ...common,
          provider: 'slack',
          slackBotCredentialId: option.slackBotCredentialId,
          requiredScopes: option.requiredScopes,
        }
      : { ...common, provider: option.provider }
  })
}
