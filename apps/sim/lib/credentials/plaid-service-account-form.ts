import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

export type PlaidServiceAccountFormFieldId =
  | 'environment'
  | 'clientId'
  | 'clientSecret'
  | 'accessToken'

export type PlaidServiceAccountEnvironment = 'production' | 'sandbox'

export const PLAID_SERVICE_ACCOUNT_ENVIRONMENTS = ['production', 'sandbox'] as const

interface PlaidServiceAccountFormOption {
  value: PlaidServiceAccountEnvironment
  label: string
}

export interface PlaidServiceAccountFormField {
  id: PlaidServiceAccountFormFieldId
  label: string
  placeholder: string
  secret: boolean
  hint?: string
  options?: readonly PlaidServiceAccountFormOption[]
}

export const PLAID_SERVICE_ACCOUNT_FORM_FIELDS: readonly PlaidServiceAccountFormField[] = [
  {
    id: 'environment',
    label: 'Environment',
    placeholder: 'Select the Plaid environment',
    secret: false,
    hint: 'Use the environment that issued both the secret and Item access token.',
    options: [
      { value: 'production', label: 'Production' },
      { value: 'sandbox', label: 'Sandbox' },
    ],
  },
  {
    id: 'clientId',
    label: 'Client ID',
    placeholder: 'Paste your Plaid client ID',
    secret: true,
  },
  {
    id: 'clientSecret',
    label: 'Secret',
    placeholder: 'Paste the secret for the selected environment',
    secret: true,
    hint: 'Paste the secret for the selected environment.',
  },
  {
    id: 'accessToken',
    label: 'Item access token',
    placeholder: 'access-production-… or access-sandbox-…',
    secret: true,
    hint: 'This long-lived token is specific to one linked Plaid Item.',
  },
]

export const PLAID_SERVICE_ACCOUNT_FORM = {
  providerId: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
  serviceLabel: 'Plaid',
  connectNoun: 'Item credential',
  catalogDescription:
    'Connect one workspace credential for a Plaid Item using application credentials and an Item access token.',
  docsUrl: 'https://docs.sim.ai/integrations/plaid',
  helpText:
    'This workspace credential is available according to workspace credential permissions. The Item access token is long-lived and specific to one linked Item; create another credential for each Item.',
  displayNamePlaceholder: 'Defaults to the verified Plaid Item ID',
  fields: PLAID_SERVICE_ACCOUNT_FORM_FIELDS,
  errorMessages: {
    invalid_credentials:
      "We couldn't authenticate this Plaid Item. Check that the client ID, environment secret, and Item access token all belong to the selected environment.",
    provider_unavailable:
      "We couldn't reach Plaid to verify this credential. Try again in a moment.",
    duplicate_display_name: 'A credential with that name already exists in this workspace.',
  } satisfies Record<string, string>,
  fallbackErrorMessage: "We couldn't add this Plaid Item credential. Try again in a moment.",
} as const

export const PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS = PLAID_SERVICE_ACCOUNT_FORM.fields.map(
  (field) => field.id
)

export function isPlaidServiceAccountEnvironment(
  value: string
): value is PlaidServiceAccountEnvironment {
  return PLAID_SERVICE_ACCOUNT_ENVIRONMENTS.some((environment) => environment === value)
}
