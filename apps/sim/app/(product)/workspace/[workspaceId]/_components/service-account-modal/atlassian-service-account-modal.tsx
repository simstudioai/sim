'use client'

import { TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { useAtlassianServiceAccount } from '@/platform/lib/data/credentials'

interface AtlassianServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** The vendor the setup is titled with (family name, e.g. "Atlassian"). */
  serviceName: string
  /** Receives the new credential id so the picker can select it. */
  onCreated: (credentialId: string) => void
  /** The product the setup was opened from, recorded on the credential and naming its token hint. */
  atlassianProduct?: 'jira' | 'confluence'
  /** A product-specific setup guide, in place of the Atlassian service-account guide. */
  setupGuideUrl?: string
}

/**
 * Adds an Atlassian service account from an API token and site domain. The domain field warns when
 * it does not look like an Atlassian site, and the server's verification failure reads as what to
 * fix: the token, the domain or Atlassian's availability.
 */
export function AtlassianServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  serviceName,
  onCreated,
  atlassianProduct,
  setupGuideUrl,
}: AtlassianServiceAccountModalProps) {
  const form = useAtlassianServiceAccount({
    open,
    workspaceId,
    atlassianProduct,
    setupGuideUrl,
    onCreated,
  })
  const docsUrl = form.docsUrl

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${serviceName} service account`}
      confirmLabel={form.isPending ? 'Adding…' : 'Add service account'}
      confirmDisabled={form.confirmDisabled}
      pending={form.isPending}
      onConfirm={() => form.submit()}
      footerStartAction={{
        label: 'Setup guide',
        variant: 'quiet',
        onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
      }}
    >
      <SecretField
        label='API token'
        value={form.apiToken}
        onChange={form.setApiToken}
        placeholder='Paste API token'
        name='atlassian_service_account_api_token'
        autoComplete='new-password'
        hint={form.apiTokenHint}
        maskAsText
        required
      />
      <TextField
        label='Site domain'
        value={form.domain}
        onChange={form.setDomain}
        placeholder='your-team.atlassian.net'
        autoComplete='off'
        error={form.domainError}
        required
      />
      <TextField
        label='Display name'
        value={form.displayName}
        onChange={form.setDisplayName}
        placeholder="Defaults to the account's Atlassian display name"
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
