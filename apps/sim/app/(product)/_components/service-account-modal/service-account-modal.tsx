'use client'

import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { AtlassianServiceAccountModal } from '@/app/(product)/_components/service-account-modal/atlassian-service-account-modal'
import { GoogleServiceAccountModal } from '@/app/(product)/_components/service-account-modal/google-service-account-modal'
import { OciApiKeyModal } from '@/app/(product)/_components/service-account-modal/oci-api-key-modal'
import { OracleDatabaseAccountModal } from '@/app/(product)/_components/service-account-modal/oracle-database-account-modal'
import { SlackBotModal } from '@/app/(product)/_components/service-account-modal/slack-bot-modal'
import {
  type ResourceScope,
  serviceAccountSetupKind,
  useServiceAccountForm,
} from '@/platform/lib/data/credentials'

interface SetupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ResourceScope
  /** The vendor the setup is titled with, such as "Atlassian" for a family key. */
  serviceName: string
  /** Receives the new credential, so the picker can select it. */
  onCreated: (credentialId: string) => void
}

interface ServiceAccountModalProps extends SetupModalProps {
  serviceAccountProviderId: string
  /** The Atlassian product the account is for, which picks its setup guide. */
  atlassianProduct?: 'jira' | 'confluence'
  /** Overrides the Atlassian setup guide, such as a search connector's own page. */
  atlassianSetupGuideUrl?: string
}

/**
 * Adds a service account in place, from a workflow block's credential picker, a knowledge connector
 * or an organization's Search source, owned by the workspace or organization `scope` names, with the
 * dialog its provider needs: a pasted token or an app's client credentials, a
 * Google JSON key, an Atlassian API token, an OCI signing key, an Oracle Database wallet or a custom
 * Slack bot. The provider verifies the secret before it is stored, and `onCreated` receives the new
 * credential to select.
 */
export function ServiceAccountModal({
  serviceAccountProviderId,
  atlassianProduct,
  atlassianSetupGuideUrl,
  open,
  onOpenChange,
  scope,
  serviceName,
  onCreated,
}: ServiceAccountModalProps) {
  switch (serviceAccountSetupKind(serviceAccountProviderId)) {
    case 'form':
      return (
        <KeyFormModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceAccountProviderId={serviceAccountProviderId}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'google':
      return (
        <GoogleServiceAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'atlassian':
      return (
        <AtlassianServiceAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
          atlassianProduct={atlassianProduct}
          setupGuideUrl={atlassianSetupGuideUrl}
        />
      )
    case 'oci-api-key':
      return (
        <OciApiKeyModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'oracle-database':
      return (
        <OracleDatabaseAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'slack-bot':
      return (
        <SlackBotModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    default:
      return null
  }
}

/** A pasted token, or an app's client credentials with the grant it uses. */
function KeyFormModal({
  open,
  onOpenChange,
  scope,
  serviceAccountProviderId,
  serviceName,
  onCreated,
}: SetupModalProps & { serviceAccountProviderId: string }) {
  const form = useServiceAccountForm({ scope, serviceAccountProviderId, onCreated })
  const docsUrl = form.docsUrl

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${serviceName} ${form.connectNoun}`}
      confirmLabel={form.isPending ? 'Adding…' : `Add ${form.connectNoun}`}
      confirmDisabled={form.confirmDisabled}
      pending={form.isPending}
      onConfirm={() => form.submit()}
      footerStartAction={
        docsUrl
          ? {
              label: 'Setup guide',
              variant: 'quiet',
              onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
            }
          : undefined
      }
    >
      {form.fields.map((field) =>
        field.options ? (
          <SelectField
            key={field.id}
            label={field.label}
            value={field.value}
            onValueChange={(value) => form.setField(field.id, value)}
            options={field.options}
            hint={field.hint}
            optional={!field.required}
          />
        ) : field.multiline ? (
          <TextAreaField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => form.setField(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='off'
            spellCheck={false}
            required={field.required}
            optional={!field.required}
            hint={field.hint}
            error={field.error}
          />
        ) : field.secret ? (
          <SecretField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => form.setField(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='new-password'
            required={field.required}
            optional={!field.required}
            hint={field.hint}
            error={field.error}
          />
        ) : (
          <TextField
            key={field.id}
            label={field.label}
            value={field.value}
            onChange={(value) => form.setField(field.id, value)}
            placeholder={field.placeholder}
            autoComplete='off'
            required={field.required}
            optional={!field.required}
            hint={field.hint}
            error={field.error}
          />
        )
      )}
      <TextField
        label='Display name'
        value={form.displayName}
        onChange={form.setDisplayName}
        placeholder={`Defaults to the ${form.serviceLabel} account name`}
        autoComplete='off'
        optional
      />
      <TextAreaField
        label='Description'
        value={form.description}
        onChange={form.setDescription}
        placeholder='Optional description'
        maxLength={500}
        optional
      />
    </Modal>
  )
}
