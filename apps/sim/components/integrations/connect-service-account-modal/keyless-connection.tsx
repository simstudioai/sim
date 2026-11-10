'use client'

import { useState } from 'react'
import { ChipModalError, ChipModalField } from '@sim/emcn-legacy'
import { generateShortId } from '@sim/utils/id'
import { isApiClientError } from '@/lib/api/client/errors'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { WorkloadIdentityProvider } from '@/lib/credentials/workload-identity/audiences'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
  useWorkloadIdentitySetup,
} from '@/hooks/queries/scoped-credentials'

/**
 * Shared plumbing for connect dialogs whose credential is a JSON configuration
 * that may be keyless (trusting Sim's workload-identity issuer): the AWS and
 * Databricks dialogs differ only in their own fields and trust snippet.
 */

export type TrustSubjectChoice = 'keep' | 'new'

interface KeylessSetupInput {
  provider: WorkloadIdentityProvider
  workspaceId?: string
  organizationId?: string
  credentialId?: string
}

/**
 * Whether this dialog can offer a keyless mode, and the trust setup to show.
 *
 * Keyless subjects bind to a workspace, so organization credentials never
 * offer it, and a deployment without a signing key reports it unavailable. On
 * reconnect the configured trust is kept by default: issuing a new subject
 * would break the role or federation policy the customer already set up.
 */
export function useKeylessSetup({
  provider,
  workspaceId,
  organizationId,
  credentialId,
}: KeylessSetupInput) {
  const [sessionKey] = useState(() => generateShortId())
  const [subjectChoice, setSubjectChoice] = useState<TrustSubjectChoice>(
    credentialId ? 'keep' : 'new'
  )
  const workspaceScoped = Boolean(workspaceId) && !organizationId
  const setup = useWorkloadIdentitySetup({
    workspaceId,
    provider,
    sessionKey,
    enabled: workspaceScoped,
  })
  const trust = setup.data?.available ? setup.data : undefined
  return {
    /** Undefined while this deployment's support is still loading. */
    available: workspaceScoped ? setup.data?.available : false,
    isReconnect: Boolean(credentialId),
    subjectChoice,
    setSubjectChoice,
    /** The new subject to submit, or undefined when keeping the stored one. */
    trust: subjectChoice === 'new' ? trust : undefined,
    /** Ready to submit a keyless configuration. */
    ready: subjectChoice === 'keep' ? Boolean(credentialId) : Boolean(trust),
    error: setup.isError ? setup.error : null,
  }
}

export type KeylessSetup = ReturnType<typeof useKeylessSetup>

/** The subject fields of a keyless config: a new subject with its proof, or none to keep the stored one. */
export function keylessSubjectFields(setup: KeylessSetup) {
  return setup.trust ? { subject: setup.trust.subject, subjectProof: setup.trust.subjectProof } : {}
}

interface KeylessTrustFieldsProps {
  setup: KeylessSetup
}

/** Reconnect choice plus the issuer, audience, and subject the customer configures. */
export function KeylessTrustFields({ setup }: KeylessTrustFieldsProps) {
  return (
    <>
      {setup.isReconnect && (
        <ChipModalField
          type='dropdown'
          title='Trust setup'
          value={setup.subjectChoice}
          onChange={(value) => setup.setSubjectChoice(value as TrustSubjectChoice)}
          options={[
            { value: 'keep', label: 'Keep the subject this credential already uses' },
            { value: 'new', label: 'Issue a new subject' },
          ]}
          hint={
            setup.subjectChoice === 'keep'
              ? 'Your existing trust configuration keeps working.'
              : 'You must update your trust configuration to the new subject before saving.'
          }
        />
      )}
      {setup.error && (
        <ChipModalError>
          {isApiClientError(setup.error) && setup.error.message
            ? setup.error.message
            : 'Could not start a keyless connection.'}
        </ChipModalError>
      )}
      {setup.trust && (
        <>
          <ChipModalField
            type='copy'
            title='Issuer'
            value={setup.trust.issuer}
            copyLabel='Copy issuer'
          />
          <ChipModalField
            type='copy'
            title='Audience'
            value={setup.trust.audience}
            copyLabel='Copy audience'
          />
          <ChipModalField
            type='copy'
            title='Subject'
            value={setup.trust.subject}
            copyLabel='Copy subject'
            hint='Unique to this credential. Your configuration trusts only this subject.'
          />
        </>
      )}
    </>
  )
}

interface SavedConnectionSubmitInput {
  providerId: string
  workspaceId?: string
  organizationId?: string
  credentialId?: string
  onCreated?: (credentialId: string) => void
  onClose: () => void
}

/**
 * Creates or reconnects a service-account credential from its JSON
 * configuration. Verification failures surface the server's own message — for
 * these providers it names what to fix (the trust policy, the role, the host).
 */
export function useSavedConnectionSubmit({
  providerId,
  workspaceId,
  organizationId,
  credentialId,
  onCreated,
  onClose,
}: SavedConnectionSubmitInput) {
  const [error, setError] = useState<string | null>(null)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  const submit = async (input: {
    config: Record<string, unknown>
    displayName: string
    description: string
  }) => {
    setError(null)
    const fields = {
      ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
      serviceAccountJson: JSON.stringify(input.config),
      displayName: input.displayName.trim() || undefined,
    }
    try {
      let connectedId = credentialId
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...fields,
          credentialId,
          description: input.description.trim() || null,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...fields,
          description: input.description.trim() || undefined,
          type: 'service_account',
          providerId,
        })
        connectedId = created.credential.id
      }
      if (connectedId) onCreated?.(connectedId)
      onClose()
    } catch (submitError) {
      if (isApiClientError(submitError) && submitError.code === 'duplicate_display_name') {
        setError('A credential with that name already exists. Choose a different display name.')
        return
      }
      setError(
        isApiClientError(submitError) && submitError.message
          ? submitError.message
          : 'Could not verify the credential. Check the details and try again.'
      )
    }
  }

  return {
    submit,
    error,
    clearError: () => setError(null),
    isPending: createCredential.isPending || updateCredential.isPending,
  }
}
