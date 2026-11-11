'use client'

import { ChipModalField, ChipTextarea } from '@sim/emcn'
import {
  googleWorkloadIdentityAudience,
  googleWorkloadIdentitySetupCommands,
  isGoogleProjectNumber,
  isGoogleServiceAccountEmail,
  isGoogleWorkloadIdentityId,
} from '@/lib/credentials/google-workload-identity'
import {
  type KeylessSetup,
  KeylessTrustFields,
  keylessSubjectFields,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'

/** What the person enters for a keyless Google Cloud credential. */
export interface GoogleKeylessInput {
  projectNumber: string
  poolId: string
  providerId: string
  serviceAccountEmail: string
}

export const EMPTY_GOOGLE_KEYLESS_INPUT: GoogleKeylessInput = {
  projectNumber: '',
  poolId: '',
  providerId: '',
  serviceAccountEmail: '',
}

function normalize(input: GoogleKeylessInput): GoogleKeylessInput {
  return {
    projectNumber: input.projectNumber.trim(),
    poolId: input.poolId.trim(),
    providerId: input.providerId.trim(),
    serviceAccountEmail: input.serviceAccountEmail.trim().toLowerCase(),
  }
}

/** Whether every field has Google's documented format, so the commands can be shown. */
export function isGoogleKeylessInputComplete(input: GoogleKeylessInput): boolean {
  const value = normalize(input)
  return (
    isGoogleProjectNumber(value.projectNumber) &&
    isGoogleWorkloadIdentityId(value.poolId) &&
    isGoogleWorkloadIdentityId(value.providerId) &&
    isGoogleServiceAccountEmail(value.serviceAccountEmail)
  )
}

/** The `serviceAccountJson` a keyless Google credential is submitted as. */
export function buildGoogleKeylessConfig(input: GoogleKeylessInput, setup: KeylessSetup) {
  return { authType: 'workload_identity', ...normalize(input), ...keylessSubjectFields(setup) }
}

interface GoogleKeylessFieldsProps {
  input: GoogleKeylessInput
  onChange: (input: GoogleKeylessInput) => void
  setup: KeylessSetup
}

/**
 * The workload identity provider and service account of a keyless Google
 * Cloud credential, plus the trust values and gcloud commands to paste.
 */
export function GoogleKeylessFields({ input, onChange, setup }: GoogleKeylessFieldsProps) {
  const complete = isGoogleKeylessInputComplete(input)
  const value = normalize(input)
  const audience = complete ? googleWorkloadIdentityAudience(value) : undefined
  const commands =
    complete && setup.trust
      ? googleWorkloadIdentitySetupCommands({
          ref: value,
          serviceAccountEmail: value.serviceAccountEmail,
          issuer: setup.trust.issuer,
          subject: setup.trust.subject,
        })
      : null
  const edit = (field: keyof GoogleKeylessInput) => (next: string) =>
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
      <KeylessTrustFields setup={setup} audience={audience} />
      {commands && (
        <ChipModalField
          type='custom'
          title='Setup commands'
          hint='They run in the project above and create the pool and an OIDC provider that accepts only this credential’s subject, then let that subject impersonate the service account. If the pool already exists, skip the first command.'
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
