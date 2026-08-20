import { AuditAction, AuditResourceType } from '@sim/audit'
import { truncate } from '@sim/utils/string'
import type { PlaidOptionsBody, PlaidOptionsResponse } from '@/lib/api/contracts/selectors/plaid'
import type { PlaidOperationBody } from '@/lib/api/contracts/tools/plaid'
import { defineAuthorizedCredentialUseCase } from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { decryptPlaidServiceAccountCredential } from '@/lib/credentials/plaid-service-account'
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { mapPlaidAccount, mapPlaidInstitution, requirePlaidArrayField } from '@/tools/plaid/utils'
import { executePlaidProviderRequest, PlaidGatewayError } from '@/tools/plaid/utils.server'

export interface ListPlaidOptionsInput {
  body: PlaidOptionsBody
  signal: AbortSignal
}

function accountLabel(account: ReturnType<typeof mapPlaidAccount>): string {
  return truncate(account.mask ? `${account.name} ••••${account.mask}` : account.name, 512, '…')
}

function institutionLabel(name: string): string {
  return truncate(name, 512, '…')
}

export function plaidAccountMatchesEligibility(
  account: ReturnType<typeof mapPlaidAccount>,
  eligibility: 'all' | 'auth' | 'transactions'
): boolean {
  if (eligibility === 'all') return true
  if (eligibility === 'auth') {
    return (
      account.type === 'depository' &&
      (account.subtype === 'checking' ||
        account.subtype === 'savings' ||
        account.subtype === 'cash management')
    )
  }
  return (
    account.type === 'depository' ||
    account.type === 'credit' ||
    (account.type === 'loan' && (account.subtype === 'student' || account.subtype === 'mortgage'))
  )
}

export const listPlaidOptions = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.read,
  resolveContext: ({ input }: { input: ListPlaidOptionsInput }) =>
    resolveCredentialApplicationContext({
      credentialId: input.body.credentialId,
      assertedWorkspaceId: input.body.workspaceId,
    }),
  execute: async ({ input, context }): Promise<PlaidOptionsResponse> => {
    const credential = await decryptPlaidServiceAccountCredential(context.credential)

    let operation: PlaidOperationBody
    switch (input.body.kind) {
      case 'accounts':
        operation = {
          operation: 'plaid_get_accounts',
          credentialId: input.body.credentialId,
          input: {},
        }
        break
      case 'institution_search':
        operation = {
          operation: 'plaid_search_institutions',
          credentialId: input.body.credentialId,
          input: {
            query: input.body.query,
            country_codes: input.body.country_codes,
          },
        }
        break
      case 'institution_detail':
        operation = {
          operation: 'plaid_get_institution',
          credentialId: input.body.credentialId,
          input: {
            institution_id: input.body.institution_id,
            country_codes: input.body.country_codes,
          },
        }
        break
    }

    const response = await executePlaidProviderRequest({
      body: operation,
      credential,
      signal: input.signal,
    })

    if (input.body.kind === 'accounts') {
      const accounts = requirePlaidArrayField(response, 'accounts', 'accounts.accounts')
      const eligibility = input.body.eligibility ?? 'all'
      return {
        options: accounts
          .map((value, index) => mapPlaidAccount(value, `accounts.accounts[${index}]`))
          .filter((account) => plaidAccountMatchesEligibility(account, eligibility))
          .map((account) => ({ id: account.account_id, label: accountLabel(account) })),
      }
    }

    if (input.body.kind === 'institution_search') {
      const institutions = requirePlaidArrayField(
        response,
        'institutions',
        'institution search.institutions'
      )
      if (institutions.length > 10) {
        throw new PlaidGatewayError('Plaid returned too many institutions')
      }
      return {
        options: institutions.map((value, index) => {
          const institution = mapPlaidInstitution(
            value,
            `institution search.institutions[${index}]`
          )
          return { id: institution.institution_id, label: institutionLabel(institution.name) }
        }),
      }
    }

    const institution = mapPlaidInstitution(response.institution)
    return {
      options: [{ id: institution.institution_id, label: institutionLabel(institution.name) }],
    }
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credential.id,
    description: `Accessed Plaid service account credential for ${input.body.kind} selector`,
    metadata: {
      provider: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
      credentialType: 'service_account',
      selectorKind: input.body.kind,
    },
  }),
})
