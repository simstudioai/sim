'use client'

import { useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { useTranslations } from 'next-intl'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { Send } from '@/components/emcn/icons'
import { GeneratedPasswordInput } from '@/components/ui'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useFileShare, useUpsertFileShare } from '@/hooks/queries/public-shares'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  fileId: string
  fileName: string
  /** Share state already known from the file row, used as the initial value to avoid flicker. */
  initialShare?: ShareRecord | null
}

type AccessMode = 'private' | ShareAuthType

const ACCESS_LABELS: Record<AccessMode, string> = {
  private: 'Private',
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

function savedMode(share: ShareRecord | null): AccessMode {
  if (!share?.isActive) return 'private'
  return share.authType
}

/** True when an entry is a valid email or an `@domain` pattern. */
function isValidEmailEntry(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('@') || quickValidateEmail(normalized).isValid
}

export function ShareModal({
  open,
  onOpenChange,
  workspaceId,
  fileId,
  fileName,
  initialShare,
}: ShareModalProps) {
  const t = useTranslations('auto')
  const { data: share, isFetched } = useFileShare(workspaceId, fileId, { enabled: open })
  const { config: permissionConfig } = usePermissionConfig()
  const upsertShare = useUpsertFileShare()

  const saved = share ?? initialShare ?? null
  const savedAccessMode = savedMode(saved)

  // Reserve a token on open (one per mount — the modal remounts each open) so the
  // link can be shown and copied before the first save; it's persisted on save.
  // Only used once we've confirmed no share row exists yet, so a copied link
  // always matches what gets stored.
  const [pendingToken] = useState(() => generateShortId())
  const noExistingShare = isFetched && !share && !initialShare
  const shareUrl = saved?.url ?? (noExistingShare ? `${getBaseUrl()}/f/${pendingToken}` : null)

  // `null` until the user changes the selector, so the control always reflects the
  // authoritative saved state (which may resolve after mount via useFileShare).
  const [draftMode, setDraftMode] = useState<AccessMode | null>(null)
  const [draftPassword, setDraftPassword] = useState('')
  const [draftEmails, setDraftEmails] = useState<string[] | null>(null)
  const effectiveMode = draftMode ?? savedAccessMode
  const effectiveActive = effectiveMode !== 'private'
  const effectiveEmails = draftEmails ?? saved?.allowedEmails ?? []

  // Org access-control may restrict which auth modes are allowed (`null` = all).
  // The route is the source of truth; this just hides disallowed options.
  const allowedAuthTypes = permissionConfig.allowedFileShareAuthTypes
  const isAuthTypeAllowed = (mode: ShareAuthType) =>
    allowedAuthTypes === null || allowedAuthTypes.includes(mode)

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED')) || savedAccessMode === 'sso'
  const candidateAuthTypes: ShareAuthType[] = [
    'public',
    'password',
    'email',
    ...(ssoEnabled ? (['sso'] as const) : []),
  ]
  // Keep the saved mode visible even if newly disallowed, so the current state shows.
  const accessModes: AccessMode[] = [
    'private',
    ...candidateAuthTypes.filter((mode) => isAuthTypeAllowed(mode) || mode === savedAccessMode),
  ]

  // The selected mode is blocked when org policy disables public sharing entirely
  // (enabling a new share) or when the chosen auth mode isn't allowed.
  const modeDisallowed = effectiveMode !== 'private' && !isAuthTypeAllowed(effectiveMode)
  const enableBlockedByPolicy =
    (permissionConfig.disablePublicFileSharing && !saved?.isActive) || modeDisallowed

  // A password share needs a secret: either one already stored or a freshly typed one.
  const passwordMissing =
    effectiveMode === 'password' && !saved?.hasPassword && draftPassword.trim().length === 0
  // Email/SSO shares need at least one allowed email/domain.
  const emailsMissing =
    (effectiveMode === 'email' || effectiveMode === 'sso') && effectiveEmails.length === 0

  const emailsDirty =
    draftEmails !== null &&
    JSON.stringify(draftEmails) !== JSON.stringify(saved?.allowedEmails ?? [])
  const isDirty =
    (draftMode !== null && draftMode !== savedAccessMode) ||
    (effectiveMode === 'password' && draftPassword.length > 0) ||
    ((effectiveMode === 'email' || effectiveMode === 'sso') && emailsDirty)

  const resetDraft = () => {
    setDraftMode(null)
    setDraftPassword('')
    setDraftEmails(null)
  }

  const handleClose = () => {
    resetDraft()
    onOpenChange(false)
  }

  const handleSave = () => {
    // Persist the reserved token only when creating the row; existing shares keep
    // their own token (the server ignores this on conflict).
    const base = { workspaceId, fileId, token: saved ? undefined : pendingToken }
    const vars =
      effectiveMode === 'private'
        ? { ...base, isActive: false as const }
        : effectiveMode === 'password'
          ? {
              ...base,
              isActive: true as const,
              authType: 'password' as const,
              password: draftPassword.trim() || undefined,
            }
          : effectiveMode === 'email' || effectiveMode === 'sso'
            ? {
                ...base,
                isActive: true as const,
                authType: effectiveMode,
                allowedEmails: effectiveEmails,
              }
            : { ...base, isActive: true as const, authType: 'public' as const }

    upsertShare.mutate(vars, {
      onSuccess: () => {
        resetDraft()
        onOpenChange(false)
      },
    })
  }

  const addEmail = (value: string): boolean => {
    const normalized = value.trim().toLowerCase()
    if (!normalized || effectiveEmails.includes(normalized) || !isValidEmailEntry(normalized)) {
      return false
    }
    setDraftEmails([...effectiveEmails, normalized])
    return true
  }

  const removeEmail = (_value: string, index: number) => {
    setDraftEmails(effectiveEmails.filter((_, i) => i !== index))
  }

  const accessHint = (() => {
    if (modeDisallowed) return 'This sharing method is disabled by an administrator.'
    if (enableBlockedByPolicy)
      return 'Public sharing is disabled for this workspace by an administrator.'
    if (effectiveMode === 'private') return 'Only workspace members can access this file.'
    if (effectiveMode === 'password')
      return 'Anyone with the link and the password can view and download this file.'
    if (effectiveMode === 'email')
      return 'Only allowed emails can access this file after a one-time code.'
    if (effectiveMode === 'sso')
      return 'Only allowed emails signed in via SSO can access this file.'
    return isDirty
      ? 'Save to make this file accessible to anyone with the link.'
      : 'Anyone with the link can view and download this file.'
  })()

  const emailItems: TagItem[] = effectiveEmails.map((value) => ({ value, isValid: true }))

  return (
    <ChipModal open={open} onOpenChange={handleClose} size='sm' srTitle={`Share ${fileName}`}>
      <ChipModalHeader icon={Send} onClose={handleClose}>
        {t('share_file')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title={t('access')} hint={accessHint}>
          <ButtonGroup
            value={effectiveMode}
            onValueChange={(value) => setDraftMode(value as AccessMode)}
            aria-label={t('file_access')}
          >
            {accessModes.map((mode) => (
              <ButtonGroupItem key={mode} value={mode}>
                {ACCESS_LABELS[mode]}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        </ChipModalField>
        {effectiveMode === 'password' ? (
          <ChipModalField
            type='custom'
            title={t('password')}
            hint={
              saved?.hasPassword
                ? 'Leave blank to keep the current password.'
                : 'Anyone with the link must enter this password.'
            }
          >
            <GeneratedPasswordInput
              value={draftPassword}
              onChange={setDraftPassword}
              placeholder={saved?.hasPassword ? '••••••••' : 'Enter a password'}
            />
          </ChipModalField>
        ) : null}
        {effectiveMode === 'email' || effectiveMode === 'sso' ? (
          <ChipModalField
            type='custom'
            title={t('allowed_emails')}
            hint={t('add_specific_emails_or_whole_domains')}
          >
            <TagInput
              items={emailItems}
              onAdd={addEmail}
              onRemove={removeEmail}
              placeholder={t('enter_emails_or_domains')}
              placeholderWithTags='Add email'
            />
          </ChipModalField>
        ) : null}
        {effectiveMode !== 'private' && shareUrl ? (
          <ChipModalField type='copy' title={t('link')} value={shareUrl} copyLabel='Copy link' />
        ) : null}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        primaryAction={{
          label: upsertShare.isPending ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled:
            !isDirty ||
            upsertShare.isPending ||
            passwordMissing ||
            emailsMissing ||
            (effectiveActive && enableBlockedByPolicy),
        }}
      />
    </ChipModal>
  )
}
