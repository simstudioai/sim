'use client'

import { type ReactNode, useState } from 'react'
import {
  Chip,
  ChipButtonGroup,
  ChipButtonGroupItem,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
  useCopyToClipboard,
} from '@sim/emcn'
import { Check, Link, Send } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { GeneratedPasswordInput } from '@/components/ui'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { validateAllowlistEntry } from '@/lib/messaging/email/validation'
import { SimLinkChip } from '@/app/o/[organizationId]/links/sim-link-shortcut'
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
  /** Draws the dialog in another design language, in place of this one's. The behavior stays here. */
  renderDialog?: (dialog: ShareDialogModel) => ReactNode
}

/** Everything a share dialog shows and does, whichever design language draws it. */
export interface ShareDialogModel {
  fileName: string
  saved: ShareRecord | null
  accessHint: string
  accessModes: { value: ShareAuthType; label: string }[]
  mode: ShareAuthType
  onModeChange: (mode: ShareAuthType) => void
  password: string
  onPasswordChange: (password: string) => void
  emails: string[]
  onEmailsChange: (emails: string[]) => void
  emailValidator: (entry: string) => string | null
  /** The last save's failure, which a dialog over the page's toasts has to show itself. */
  error: string | null
  pending: boolean
  primaryLabel: string
  primaryDisabled: boolean
  isUnshareAction: boolean
  onPrimaryAction: () => void
  copied: boolean
  onCopyLink: (url: string) => void
  unshareConfirmOpen: boolean
  onUnshareConfirmOpenChange: (open: boolean) => void
  onConfirmUnshare: () => void
  onClose: () => void
}

const ACCESS_LABELS: Record<ShareAuthType, string> = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

const PRIMARY_ACTION_LABELS = {
  share: { idle: 'Share', pending: 'Sharing...' },
  update: { idle: 'Update', pending: 'Updating...' },
  unshare: { idle: 'Unshare', pending: 'Unsharing...' },
} as const

const PRIMARY_ACTION_SUCCESS_MESSAGES = {
  share: 'File shared',
  update: 'Sharing updated',
  unshare: 'File unshared',
} as const

/** Stable identity so the emails field's reconcile effect no-ops while unset. */
const EMPTY_EMAILS: string[] = []

function savedMode(share: ShareRecord | null): ShareAuthType {
  return share?.authType ?? 'public'
}

export function ShareModal({
  open,
  onOpenChange,
  workspaceId,
  fileId,
  fileName,
  initialShare,
  renderDialog,
}: ShareModalProps) {
  const {
    data: share,
    isError: isShareError,
    isFetchedAfterMount,
  } = useFileShare(workspaceId, fileId, { enabled: open })
  const { config: permissionConfig } = usePermissionConfig()
  const upsertShare = useUpsertFileShare()
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const { features } = useDeploymentShape()

  const shareReadReady = isFetchedAfterMount && !isShareError
  const saved = shareReadReady ? (share ?? null) : (share ?? initialShare ?? null)
  const savedAccessMode = savedMode(saved)

  const [draftMode, setDraftMode] = useState<ShareAuthType | null>(null)
  const [draftPassword, setDraftPassword] = useState('')
  const [draftEmails, setDraftEmails] = useState<string[] | null>(null)
  const [unshareConfirmOpen, setUnshareConfirmOpen] = useState(false)
  const effectiveMode = draftMode ?? savedAccessMode
  const effectiveEmails = draftEmails ?? saved?.allowedEmails ?? EMPTY_EMAILS

  const allowedAuthTypes = permissionConfig.allowedFileShareAuthTypes
  const isAuthTypeAllowed = (mode: ShareAuthType) =>
    allowedAuthTypes === null || allowedAuthTypes.includes(mode)

  const ssoEnabled = features.sso || savedAccessMode === 'sso'
  const candidateAuthTypes: ShareAuthType[] = [
    'public',
    'password',
    'email',
    ...(ssoEnabled ? (['sso'] as const) : []),
  ]
  const accessModes = candidateAuthTypes.filter(
    (mode) => isAuthTypeAllowed(mode) || mode === savedAccessMode
  )

  const modeDisallowed = !isAuthTypeAllowed(effectiveMode)
  const enableBlockedByPolicy =
    (permissionConfig.disablePublicFileSharing && !saved?.isActive) || modeDisallowed

  const passwordMissing =
    effectiveMode === 'password' && !saved?.hasPassword && draftPassword.trim().length === 0
  const emailsMissing =
    (effectiveMode === 'email' || effectiveMode === 'sso') && effectiveEmails.length === 0

  const emailsDirty =
    draftEmails !== null &&
    JSON.stringify(draftEmails) !== JSON.stringify(saved?.allowedEmails ?? [])
  const isDirty =
    (draftMode !== null && draftMode !== savedAccessMode) ||
    (effectiveMode === 'password' && draftPassword.length > 0) ||
    ((effectiveMode === 'email' || effectiveMode === 'sso') && emailsDirty)
  const primaryAction = saved?.isActive ? (isDirty ? 'update' : 'unshare') : 'share'
  const isUnshareAction = primaryAction === 'unshare'
  const primaryActionPending = upsertShare.isPending || (isUnshareAction && unshareConfirmOpen)
  const primaryLabel =
    PRIMARY_ACTION_LABELS[primaryAction][primaryActionPending ? 'pending' : 'idle']

  const resetDraft = () => {
    setDraftMode(null)
    setDraftPassword('')
    setDraftEmails(null)
  }

  const handleClose = () => {
    setUnshareConfirmOpen(false)
    resetDraft()
    onOpenChange(false)
  }

  const submitPrimaryAction = () => {
    if (!shareReadReady || upsertShare.isPending) return

    const base = { workspaceId, fileId, token: saved ? undefined : generateShortId() }
    const vars = isUnshareAction
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
        toast.success(PRIMARY_ACTION_SUCCESS_MESSAGES[primaryAction])
        setUnshareConfirmOpen(false)
        resetDraft()
      },
    })
  }

  const handlePrimaryAction = () => {
    if (isUnshareAction) {
      setUnshareConfirmOpen(true)
      return
    }
    submitPrimaryAction()
  }

  const accessHint = (() => {
    if (isShareError) return 'Unable to load the current sharing settings. Close and try again.'
    if (modeDisallowed) return 'This sharing method is disabled by an administrator.'
    if (enableBlockedByPolicy)
      return 'Public sharing is disabled for this workspace by an administrator.'
    if (effectiveMode === 'password')
      return 'Anyone with the link and the password can view and download this file.'
    if (effectiveMode === 'email')
      return 'Only allowed emails can access this file after a one-time code.'
    if (effectiveMode === 'sso')
      return 'Only allowed emails signed in via SSO can access this file.'
    return saved?.isActive && !isDirty
      ? 'Anyone with the link can view and download this file.'
      : `${saved?.isActive ? 'Update' : 'Share'} to make this file accessible to anyone with the link.`
  })()

  const primaryDisabled =
    upsertShare.isPending ||
    !shareReadReady ||
    (!isUnshareAction && (passwordMissing || emailsMissing || enableBlockedByPolicy))

  if (renderDialog) {
    return renderDialog({
      fileName,
      saved,
      accessHint,
      accessModes: accessModes.map((value) => ({ value, label: ACCESS_LABELS[value] })),
      mode: effectiveMode,
      onModeChange: setDraftMode,
      password: draftPassword,
      onPasswordChange: setDraftPassword,
      emails: effectiveEmails,
      onEmailsChange: setDraftEmails,
      emailValidator: validateAllowlistEntry,
      error: upsertShare.error?.message ?? null,
      pending: upsertShare.isPending,
      primaryLabel,
      primaryDisabled,
      isUnshareAction,
      onPrimaryAction: handlePrimaryAction,
      copied,
      onCopyLink: (url) => void copy(url),
      unshareConfirmOpen,
      onUnshareConfirmOpenChange: setUnshareConfirmOpen,
      onConfirmUnshare: submitPrimaryAction,
      onClose: handleClose,
    })
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={handleClose}
        size='sm'
        srTitle={`Share ${fileName}`}
        dismissDisabled={upsertShare.isPending}
      >
        <ChipModalHeader icon={Send} onClose={handleClose}>
          Share file
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='custom' title='Access' hint={accessHint}>
            <ChipButtonGroup
              value={effectiveMode}
              onValueChange={(value) => setDraftMode(value as ShareAuthType)}
              aria-label='File access'
              disabled={upsertShare.isPending}
            >
              {accessModes.map((mode) => (
                <ChipButtonGroupItem key={mode} value={mode}>
                  {ACCESS_LABELS[mode]}
                </ChipButtonGroupItem>
              ))}
            </ChipButtonGroup>
          </ChipModalField>
          {effectiveMode === 'password' ? (
            <ChipModalField
              type='custom'
              title='Password'
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
                disabled={upsertShare.isPending}
              />
            </ChipModalField>
          ) : null}
          {effectiveMode === 'email' || effectiveMode === 'sso' ? (
            <ChipModalField
              type='emails'
              title='Allowed emails'
              value={effectiveEmails}
              onChange={setDraftEmails}
              validate={validateAllowlistEntry}
              allowDomains
              placeholder='Enter emails or domains'
              placeholderWithTags='Add email or domain'
              disabled={upsertShare.isPending}
            />
          ) : null}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleClose}
          defaultAction={isUnshareAction ? 'none' : 'primary'}
          secondaryActions={
            saved?.isActive && saved.url
              ? [
                  {
                    custom: (
                      <Chip leftIcon={copied ? Check : Link} onClick={() => copy(saved.url)}>
                        {copied ? 'Copied!' : 'Copy link'}
                      </Chip>
                    ),
                  },
                  {
                    custom: (
                      <SimLinkChip url={saved.url} title={fileName.replace(/\.[^.]+$/, '')} />
                    ),
                  },
                ]
              : undefined
          }
          primaryAction={{
            label: primaryLabel,
            onClick: handlePrimaryAction,
            variant: isUnshareAction ? 'destructive' : 'primary',
            disabled: primaryDisabled,
          }}
        />
      </ChipModal>
      <ChipConfirmModal
        open={open && unshareConfirmOpen}
        onOpenChange={setUnshareConfirmOpen}
        title='Unshare file?'
        text='Are you sure you want to unshare this file? Anyone with the link will lose access.'
        confirm={{
          label: 'Unshare',
          onClick: submitPrimaryAction,
          pending: upsertShare.isPending,
          pendingLabel: 'Unsharing...',
        }}
      />
    </>
  )
}
