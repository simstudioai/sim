'use client'

import { ChipDropdown, ChipModalField, ChipTextarea } from '@sim/emcn'
import type { ReconnectDelegation } from '@/lib/api/contracts/credentials'
import {
  GOOGLE_DELEGATION_SERVICES,
  type GoogleDelegationService,
  googleDelegationScopesFor,
  googleInitialDelegatedServices,
  googleWorkloadIdentityAudience,
  googleWorkloadIdentitySetupCommands,
  isGoogleDelegationUser,
  isGoogleProjectNumber,
  isGoogleServiceAccountEmail,
  isGoogleWorkloadIdentityId,
} from '@/lib/credentials/google-workload-identity'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'
import {
  type KeylessSetup,
  KeylessTrustFields,
  keylessConfigFields,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'

/** What the person enters for a keyless Google credential. */
export interface GoogleKeylessInput {
  projectNumber: string
  poolId: string
  providerId: string
  serviceAccountEmail: string
  /** The Workspace services to delegate; none keeps the credential to Google Cloud APIs. */
  delegatedServices: GoogleDelegationService[]
  /** The Workspace user a delegated credential acts as. */
  delegatedUser: string
}

/**
 * The form a dialog opens on: a reconnect keeps the credential's stored
 * delegation, and the Workspace service the dialog was opened for is added to it.
 */
export function emptyGoogleKeylessInput(
  oauthServiceId?: string,
  stored?: ReconnectDelegation
): GoogleKeylessInput {
  return {
    projectNumber: '',
    poolId: '',
    providerId: '',
    serviceAccountEmail: '',
    delegatedServices: googleInitialDelegatedServices(oauthServiceId, stored?.services),
    delegatedUser: stored?.user ?? '',
  }
}

const DELEGATION_OPTIONS = GOOGLE_DELEGATION_SERVICES.map((service) => ({
  value: service,
  label: getServiceConfigByServiceId(service)?.name ?? service,
}))

/** "Gmail, Google Drive, …, and Google Calendar": the services keyless credentials can delegate. */
export const GOOGLE_DELEGATION_SERVICE_NAMES = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
}).format(DELEGATION_OPTIONS.map((option) => option.label))

/** Whether the provider and service account fields have Google's documented format. */
function isTrustComplete(value: GoogleKeylessInput): boolean {
  return (
    isGoogleProjectNumber(value.projectNumber) &&
    isGoogleWorkloadIdentityId(value.poolId) &&
    isGoogleWorkloadIdentityId(value.providerId) &&
    isGoogleServiceAccountEmail(value.serviceAccountEmail)
  )
}

function normalize(input: GoogleKeylessInput): GoogleKeylessInput {
  return {
    projectNumber: input.projectNumber.trim(),
    poolId: input.poolId.trim(),
    providerId: input.providerId.trim(),
    serviceAccountEmail: input.serviceAccountEmail.trim().toLowerCase(),
    delegatedServices: input.delegatedServices,
    delegatedUser: input.delegatedUser.trim().toLowerCase(),
  }
}

/**
 * Whether every field has Google's documented format, so the commands can be
 * shown, and a delegated credential names its user. A dialog opened for a
 * delegable Workspace service requires that service, since the credential is
 * useless there without it.
 */
export function isGoogleKeylessInputComplete(
  input: GoogleKeylessInput,
  requiredService?: GoogleDelegationService
): boolean {
  const value = normalize(input)
  const delegated = value.delegatedServices.length > 0
  return (
    isTrustComplete(value) &&
    (!requiredService || value.delegatedServices.includes(requiredService)) &&
    (!delegated || isGoogleDelegationUser(value.delegatedUser))
  )
}

/** The `serviceAccountJson` a keyless Google credential is submitted as. */
export function buildGoogleKeylessConfig(input: GoogleKeylessInput, setup: KeylessSetup) {
  const { delegatedServices, delegatedUser, ...ref } = normalize(input)
  return {
    authType: 'workload_identity',
    ...ref,
    ...(delegatedServices.length > 0
      ? { delegation: { user: delegatedUser, services: delegatedServices } }
      : {}),
    ...keylessConfigFields(setup),
  }
}

interface GoogleKeylessFieldsProps {
  input: GoogleKeylessInput
  onChange: (input: GoogleKeylessInput) => void
  setup: KeylessSetup
}

/**
 * The workload identity provider and service account of a keyless Google
 * credential, its optional domain-wide delegation, plus the trust values,
 * gcloud commands, and Admin console scopes to paste.
 */
export function GoogleKeylessFields({ input, onChange, setup }: GoogleKeylessFieldsProps) {
  const value = normalize(input)
  const trustComplete = isTrustComplete(value)
  const delegated = value.delegatedServices.length > 0
  const providerAudience = trustComplete ? googleWorkloadIdentityAudience(value) : undefined
  const commands =
    trustComplete && setup.trust && !setup.audienceError
      ? googleWorkloadIdentitySetupCommands({
          ref: value,
          serviceAccountEmail: value.serviceAccountEmail,
          issuer: setup.trust.issuer,
          subject: setup.trust.subject,
          domainWideDelegation: delegated,
          audience: setup.customAudience,
        })
      : null
  const edit = (field: Exclude<keyof GoogleKeylessInput, 'delegatedServices'>) => (next: string) =>
    onChange({ ...input, [field]: next })

  return (
    <>
      <ChipModalField
        type='input'
        title='Project number'
        value={input.projectNumber}
        onChange={edit('projectNumber')}
        placeholder='123456789012'
        required
        autoComplete='off'
        hint='The numeric project number (not the project ID) of the project that holds the workload identity pool.'
      />
      <ChipModalField
        type='input'
        title='Workload identity pool ID'
        value={input.poolId}
        onChange={edit('poolId')}
        placeholder='sim-pool'
        required
        autoComplete='off'
        hint='4–32 lowercase letters, digits, or hyphens; can’t start with gcp-.'
      />
      <ChipModalField
        type='input'
        title='Provider ID'
        value={input.providerId}
        onChange={edit('providerId')}
        placeholder='sim-oidc'
        required
        autoComplete='off'
        hint='4–32 lowercase letters, digits, or hyphens; can’t start with gcp-.'
      />
      <ChipModalField
        type='input'
        title='Service account email'
        value={input.serviceAccountEmail}
        onChange={edit('serviceAccountEmail')}
        placeholder='name@project-id.iam.gserviceaccount.com'
        required
        autoComplete='off'
        hint='A user-managed service account only; default …@developer.gserviceaccount.com accounts are refused. Grant it the roles your workflows need, such as BigQuery or Vertex AI roles.'
      />
      <ChipModalField type='custom' title='Domain-wide delegation'>
        {(aria) => (
          <ChipDropdown
            {...aria}
            multiple
            fullWidth
            value={input.delegatedServices}
            onChange={(services) =>
              onChange({
                ...input,
                delegatedServices: GOOGLE_DELEGATION_SERVICES.filter((service) =>
                  services.includes(service)
                ),
              })
            }
            options={DELEGATION_OPTIONS}
            allLabel='None (Google Cloud APIs only)'
            showAllOption={false}
          />
        )}
      </ChipModalField>
      {delegated && (
        <>
          <ChipModalField
            type='email'
            title='Workspace user'
            value={input.delegatedUser}
            onChange={edit('delegatedUser')}
            placeholder='user@yourcompany.com'
            required
            autoComplete='off'
            hint='Workflows act as this user only. Sim signs in as them when you save to check access.'
          />
          <ChipModalField
            type='copy'
            title='Scopes to authorize'
            value={googleDelegationScopesFor(value.delegatedServices).join(',')}
            hint='A Google Workspace super administrator authorizes the service account’s client ID (its numeric Unique ID) for these scopes under Security > Access and data control > API controls > Manage Domain Wide Delegation. Enable each service’s API in the service account’s project.'
          />
        </>
      )}
      <KeylessTrustFields
        setup={setup}
        defaultAudience={providerAudience}
        audienceHint='The default is the provider’s resource name; a custom value must be in the provider’s allowed audiences.'
      />
      {commands && (
        <ChipModalField
          type='custom'
          title='Setup commands'
          hint={
            delegated
              ? 'They run in the project above and create the pool and an OIDC provider that accepts only this credential’s subject, then let that subject impersonate and sign for the service account. If the pool already exists, skip the first command.'
              : 'They run in the project above and create the pool and an OIDC provider that accepts only this credential’s subject, then let that subject impersonate the service account. If the pool already exists, skip the first command.'
          }
        >
          {(aria) => (
            <ChipTextarea
              {...aria}
              readOnly
              value={commands}
              className='min-h-[260px] font-mono text-xs'
              spellCheck={false}
            />
          )}
        </ChipModalField>
      )}
    </>
  )
}
