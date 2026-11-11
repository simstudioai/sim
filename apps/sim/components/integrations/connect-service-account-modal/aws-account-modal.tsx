'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn-legacy'
import {
  KeylessTrustFields,
  keylessSubjectFields,
  useKeylessSetup,
  useSavedConnectionSubmit,
} from '@/components/integrations/connect-service-account-modal/keyless-connection'
import { resourceScopeFromOwner, resourceScopeKey } from '@/lib/core/resource-scope'
import { buildAwsTrustPolicy } from '@/lib/credentials/config-service-accounts/descriptors'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { withBrandIcon } from '@/blocks/brand-icon'

interface AwsAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  onCreated?: (credentialId: string) => void
}

type AwsAuthType = 'oidc_role' | 'access_keys' | 'assume_role'

const ROLE_ARN_PLACEHOLDER = 'arn:aws:iam::123456789012:role/sim-workflows'
const AUTH_TYPE_HINTS: Record<AwsAuthType, string> = {
  oidc_role: 'No keys are stored. Sim signs a short-lived token that your role trusts.',
  assume_role: 'Sim uses the keys only to assume the role, then works with temporary credentials.',
  access_keys: 'Sim signs requests with these long-lived keys.',
}

/** Saved AWS identities share the standard credential create/reconnect lifecycle. */
export function AwsAccountModal(props: AwsAccountModalProps) {
  if (!props.open) return null
  return (
    <AwsAccountForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function AwsAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  onCreated,
}: AwsAccountModalProps) {
  const keyless = useKeylessSetup({ provider: 'aws', workspaceId, organizationId, credentialId })
  const { submit, error, clearError, isPending } = useSavedConnectionSubmit({
    providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
    workspaceId,
    organizationId,
    credentialId,
    onCreated,
    onClose: () => onOpenChange(false),
  })
  const [selectedAuthType, setSelectedAuthType] = useState<AwsAuthType | null>(null)
  const [roleArn, setRoleArn] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [externalId, setExternalId] = useState('')
  const [stsRegion, setStsRegion] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState('')

  // A reconnect opens on the credential's stored mode, so it never switches auth by default;
  // a new connection defaults to keyless wherever this deployment supports it.
  const defaultAuthType: AwsAuthType = credentialId
    ? (keyless.reconnectAuthType ?? 'access_keys')
    : keyless.available
      ? 'oidc_role'
      : 'access_keys'
  const authType: AwsAuthType = selectedAuthType ?? defaultAuthType
  const needsKeys = authType === 'access_keys' || authType === 'assume_role'
  const needsRole = authType === 'oidc_role' || authType === 'assume_role'
  const disabled =
    isPending ||
    (needsKeys && (!accessKeyId.trim() || !secretAccessKey)) ||
    (needsRole && !roleArn.trim()) ||
    (authType === 'oidc_role' && !keyless.ready)

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    clearError()
  }

  const buildConfig = (): Record<string, unknown> => {
    if (authType === 'oidc_role') {
      return { authType, roleArn: roleArn.trim(), ...keylessSubjectFields(keyless) }
    }
    const keys = { accessKeyId: accessKeyId.trim(), secretAccessKey }
    if (authType === 'assume_role') {
      return {
        authType,
        ...keys,
        roleArn: roleArn.trim(),
        ...(externalId.trim() ? { externalId: externalId.trim() } : {}),
      }
    }
    return { authType, ...keys, ...(stsRegion.trim() ? { stsRegion: stsRegion.trim() } : {}) }
  }

  const trustPolicy =
    authType === 'oidc_role' && keyless.trust?.audience
      ? buildAwsTrustPolicy({ ...keyless.trust, audience: keyless.trust.audience }, roleArn)
      : null
  const action = credentialId ? 'Reconnect' : 'Add'
  const authOptions = [
    ...(keyless.available
      ? [{ value: 'oidc_role', label: 'IAM role (keyless, via Sim OIDC)' }]
      : []),
    { value: 'access_keys', label: 'Access keys' },
    { value: 'assume_role', label: 'Access keys that assume an IAM role' },
  ]

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={`${action} AWS credential`}>
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {action} AWS credential
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authType}
          onChange={(value) => {
            setSelectedAuthType(value as AwsAuthType)
            clearError()
          }}
          options={authOptions}
          placeholder='Choose how Sim signs in to AWS'
          required
          hint={AUTH_TYPE_HINTS[authType]}
        />

        {authType === 'oidc_role' && <KeylessTrustFields setup={keyless} />}

        {needsKeys && (
          <>
            <ChipModalField
              type='input'
              title='Access key ID'
              value={accessKeyId}
              onChange={edit(setAccessKeyId)}
              placeholder='AKIA...'
              required
              autoComplete='off'
            />
            <ChipModalField type='custom' title='Secret access key' required>
              {(aria) => (
                <SecretInput
                  {...aria}
                  value={secretAccessKey}
                  onChange={edit(setSecretAccessKey)}
                  placeholder='Enter the secret access key'
                  autoComplete='new-password'
                  data-lpignore='true'
                />
              )}
            </ChipModalField>
          </>
        )}

        {authType === 'access_keys' && (
          <ChipModalField
            type='input'
            title='STS region'
            value={stsRegion}
            onChange={edit(setStsRegion)}
            placeholder='us-east-1'
            hint='Only needed for AWS GovCloud or China keys, e.g. us-gov-west-1 or cn-north-1.'
            autoComplete='off'
          />
        )}

        {needsRole && (
          <ChipModalField
            type='input'
            title='Role ARN'
            value={roleArn}
            onChange={edit(setRoleArn)}
            placeholder={ROLE_ARN_PLACEHOLDER}
            required
            autoComplete='off'
          />
        )}

        {authType === 'assume_role' && (
          <ChipModalField
            type='input'
            title='External ID'
            value={externalId}
            onChange={edit(setExternalId)}
            placeholder='Optional, if the role requires one'
            autoComplete='off'
          />
        )}

        {trustPolicy && (
          <ChipModalField
            type='custom'
            title='Role trust policy'
            hint='Enter the Role ARN first; the policy fills in its account ID. Add the issuer and audience above as an IAM identity provider (once per AWS account), set this as the role’s trust policy, then grant the role the permissions your workflows need.'
          >
            {(aria) => (
              <ChipTextarea
                {...aria}
                readOnly
                value={trustPolicy}
                className='min-h-[220px] font-mono text-xs'
                spellCheck={false}
              />
            )}
          </ChipModalField>
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the AWS identity ARN'
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional description'
          maxLength={500}
          minHeight={80}
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () =>
              window.open(
                'https://docs.sim.ai/integrations/aws-credentials',
                '_blank',
                'noopener,noreferrer'
              ),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} credential`,
          onClick: () => {
            if (!disabled) void submit({ config: buildConfig(), displayName, description })
          },
          disabled,
        }}
      />
    </ChipModal>
  )
}
