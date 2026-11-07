'use client'

import { useState } from 'react'
import { toast, useCopyToClipboard } from '@sim/emcn-legacy'
import { generateShortId } from '@sim/utils/id'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { validateAllowlistEntry } from '@/lib/messaging/email/validation'
import { useFileShare, useUpsertFileShare } from '@/hooks/queries/public-shares'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  fileId: string
  fileName: string
  /** Share state already known from the file row, used as the initial value to avoid flicker. */
  initialShare?: ShareRecord | null
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

/** A file share's rules and requests, for whichever dialog draws them. */
export function useShareDialog({
  open,
  onOpenChange,
  workspaceId,
  fileId,
  initialShare,
}: Omit<ShareDialogProps, 'fileName'>) {
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

  /** Settles with the save, for a dialog to hold on. A failure stays on `upsertShare.error`. */
  const submitPrimaryAction = async () => {
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

    try {
      await upsertShare.mutateAsync(vars)
    } catch {
      return
    }
    toast.success(PRIMARY_ACTION_SUCCESS_MESSAGES[primaryAction])
    setUnshareConfirmOpen(false)
    resetDraft()
  }

  const handlePrimaryAction = async () => {
    if (isUnshareAction) {
      setUnshareConfirmOpen(true)
      return
    }
    await submitPrimaryAction()
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

  return {
    saved,
    accessHint,
    accessModes: accessModes.map((value) => ({ value, label: ACCESS_LABELS[value] })),
    mode: effectiveMode,
    setMode: setDraftMode,
    password: draftPassword,
    setPassword: setDraftPassword,
    emails: effectiveEmails,
    setEmails: setDraftEmails,
    validateEmail: validateAllowlistEntry,
    /** The last save's failure, which a dialog over the page's toasts has to show itself. */
    error: upsertShare.error?.message ?? null,
    pending: upsertShare.isPending,
    primaryLabel,
    primaryDisabled,
    isUnshareAction,
    runPrimaryAction: handlePrimaryAction,
    copied,
    copy,
    unshareConfirmOpen,
    setUnshareConfirmOpen,
    confirmUnshare: submitPrimaryAction,
    close: handleClose,
  }
}
