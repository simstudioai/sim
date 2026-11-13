'use client'

import { useState } from 'react'
import { ChipModalError, ChipModalField } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { isApiClientError } from '@/lib/api/client/errors'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  WORKLOAD_IDENTITY_KEYLESS_CONFIGS,
  WORKLOAD_IDENTITY_PROVIDER_AUTH_TYPES,
  type WorkloadIdentityProvider,
  type WorkloadIdentityProviderAuthType,
  workloadIdentityAudienceSchema,
} from '@/lib/credentials/workload-identity/audiences'
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

interface KeylessSetupInput<P extends WorkloadIdentityProvider> {
  provider: P
  workspaceId?: string
  organizationId?: string
  credentialId?: string
  /** False when the dialog cannot offer keyless at all (a Google Workspace service). */
  enabled?: boolean
}

/**
 * Whether this dialog can offer a keyless mode, and the trust setup to show.
 *
 * Keyless subjects bind to a workspace, so organization credentials never
 * offer it, and a deployment without a signing key reports it unavailable. On
 * reconnect the configured trust is kept by default: issuing a new subject
 * would break the role or federation policy the customer already set up.
 */
export function useKeylessSetup<P extends WorkloadIdentityProvider>({
  provider,
  workspaceId,
  organizationId,
  credentialId,
  enabled = true,
}: KeylessSetupInput<P>) {
  const [sessionKey] = useState(() => generateShortId())
  const [subjectChoice, setSubjectChoice] = useState<TrustSubjectChoice>(
    credentialId ? 'keep' : 'new'
  )
  const workspaceScoped = enabled && Boolean(workspaceId) && !organizationId
  const setup = useWorkloadIdentitySetup({
    workspaceId,
    provider,
    sessionKey,
    enabled: workspaceScoped,
    credentialId,
  })
  const trust = setup.data?.available ? setup.data : undefined
  // Undefined until edited, so a reconnect opens on its stored audience once that loads.
  const [audienceInput, setAudienceInput] = useState<string>()
  const audienceValue = audienceInput ?? setup.data?.reconnectAudience ?? ''
  const defaultAudience = setup.data?.available ? setup.data.audience : undefined
  const typedAudience = audienceValue.trim()
  const typedCustom = typedAudience && typedAudience !== defaultAudience ? typedAudience : undefined
  const audienceCheck = typedCustom
    ? workloadIdentityAudienceSchema(provider).safeParse(typedCustom)
    : undefined
  const audienceError =
    audienceCheck && !audienceCheck.success ? audienceCheck.error.issues[0]?.message : undefined
  const customAudience = audienceError ? undefined : typedCustom
  const storedAuthType = providerAuthType(provider, setup.data?.reconnectAuthType)
  // A keyless credential reopens on keyless only where this deployment can still sign.
  const reconnectAuthType =
    storedAuthType === WORKLOAD_IDENTITY_KEYLESS_CONFIGS[provider].authType && !trust
      ? undefined
      : storedAuthType
  return {
    /** Undefined while this deployment's support is still loading. */
    available: workspaceScoped ? setup.data?.available : false,
    /** The stored mode of the credential being reconnected; a reconnect reopens on it. */
    reconnectAuthType,
    /** A reconnected keyless Google credential's domain-wide delegation; a reconnect keeps it. */
    reconnectDelegation: setup.data?.reconnectDelegation,
    /** A reconnected Microsoft app credential's national cloud; a reconnect reopens on it. */
    reconnectCloud: setup.data?.reconnectCloud,
    /**
     * Whether the reconnect fields above came back. False while they load, after a failed
     * lookup, and for an organization credential, whose stored secret this lookup never reads.
     */
    reconnectFieldsLoaded: workspaceScoped && setup.isSuccess,
    isReconnect: Boolean(credentialId),
    subjectChoice,
    setSubjectChoice,
    /** The new subject to submit, or undefined when keeping the stored one. */
    trust: subjectChoice === 'new' ? trust : undefined,
    /** The audience field's value; empty keeps the default. */
    audienceInput: audienceValue,
    setAudienceInput,
    /** The provider's default audience; undefined for Google, whose default is each credential's provider. */
    defaultAudience,
    /** The audience typed into the field, unless it is blank, the default, or invalid. */
    customAudience,
    /** Why the typed audience can't be used; setup snippets stay hidden until it can. */
    audienceError,
    /** The audience tokens carry: the custom one, else the default; undefined while invalid. */
    audience: audienceError ? undefined : (customAudience ?? defaultAudience),
    /** Ready to submit a keyless configuration. */
    ready: !audienceError && (subjectChoice === 'keep' ? Boolean(credentialId) : Boolean(trust)),
    error: setup.isError ? setup.error : null,
  }
}

export type KeylessSetup<P extends WorkloadIdentityProvider = WorkloadIdentityProvider> =
  ReturnType<typeof useKeylessSetup<P>>

function providerAuthType<P extends WorkloadIdentityProvider>(
  provider: P,
  value: string | undefined
): WorkloadIdentityProviderAuthType<P> | undefined {
  const modes: readonly WorkloadIdentityProviderAuthType<P>[] =
    WORKLOAD_IDENTITY_PROVIDER_AUTH_TYPES[provider]
  return modes.find((mode) => mode === value)
}

/**
 * The trust fields of a keyless config: a new subject with its proof (none keeps the
 * stored one), and the custom audience when one is set (none means the default).
 */
export function keylessConfigFields(setup: KeylessSetup) {
  return {
    ...(setup.trust
      ? { subject: setup.trust.subject, subjectProof: setup.trust.subjectProof }
      : {}),
    ...(setup.customAudience ? { audience: setup.customAudience } : {}),
  }
}

interface KeylessTrustFieldsProps {
  setup: KeylessSetup
  /** The default audience, for a provider without a fixed one (Google: the credential's own provider). */
  defaultAudience?: string
  /** Where the provider lists the audience it accepts, appended to the field's hint. */
  audienceHint: string
  /** Where in the provider's console the values below are pasted. */
  pasteHint?: string
}

/** Reconnect choice plus the issuer, audience, and subject the customer configures. */
export function KeylessTrustFields({
  setup,
  defaultAudience = setup.defaultAudience,
  audienceHint,
  pasteHint,
}: KeylessTrustFieldsProps) {
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
            hint={pasteHint}
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
      {(setup.trust || setup.isReconnect) && (
        <ChipModalField
          type='input'
          title='Audience'
          value={setup.audienceInput}
          onChange={setup.setAudienceInput}
          placeholder={defaultAudience ?? 'Default audience'}
          error={setup.audienceError}
          hint={
            setup.isReconnect && !setup.trust
              ? 'If you change the audience, add the new value to your trust configuration before saving.'
              : `Optional; blank uses the default. A custom value limits trust to tokens issued for it. ${audienceHint}`
          }
        />
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
  /**
   * Copy for a shared verification code (`invalid_credentials`, …) the
   * provider reports by code rather than with its own message; undefined
   * keeps the server's message.
   */
  messageForCode?: (code: string) => string | undefined
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
  messageForCode,
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
      const codeMessage =
        isApiClientError(submitError) && submitError.code
          ? messageForCode?.(submitError.code)
          : undefined
      setError(
        codeMessage ??
          (isApiClientError(submitError) && submitError.message
            ? submitError.message
            : 'Could not verify the credential. Check the details and try again.')
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
