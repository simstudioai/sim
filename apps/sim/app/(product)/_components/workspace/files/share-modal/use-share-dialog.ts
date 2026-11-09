'use client'

import { useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { toast } from '@/lib/toast/sink'
import {
  type ShareAuthType,
  type ShareRecord,
  useDeploymentShape,
  useFileAccess,
  useFileShare,
  useUpsertFileShare,
  validateAllowlistEntry,
} from '@/platform/lib/data/files'

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  fileId: string
  fileName: string
  /** Share state already known from the file row, shown until the share's own read lands. */
  initialShare?: ShareRecord | null
}

const ACCESS_LABELS: Record<ShareAuthType, string> = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

const PRIMARY_ACTION_LABELS = {
  share: { idle: 'Share', pending: 'Sharing…' },
  update: { idle: 'Update', pending: 'Updating…' },
  unshare: { idle: 'Unshare', pending: 'Unsharing…' },
} as const

const PRIMARY_ACTION_SUCCESS_MESSAGES = {
  share: 'File shared',
  update: 'Sharing updated',
  unshare: 'File unshared',
} as const

/** The API's limit on a share's allowlist, so a long paste is refused before the save. */
const MAX_ALLOWED_EMAILS = 200

const EMPTY_EMAILS: string[] = []

function savedMode(share: ShareRecord | null): ShareAuthType {
  return share?.authType ?? 'public'
}

/** A file share's rules and requests, for the dialog that draws them. */
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
  const access = useFileAccess(workspaceId)
  const upsertShare = useUpsertFileShare()
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

  const allowedAuthTypes = access.allowedShareAuthTypes
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
  const enableBlockedByPolicy = (access.disablePublicSharing && !saved?.isActive) || modeDisallowed

  const usesAllowlist = effectiveMode === 'email' || effectiveMode === 'sso'
  const passwordMissing =
    effectiveMode === 'password' && !saved?.hasPassword && draftPassword.trim().length === 0
  const emailsMissing = usesAllowlist && effectiveEmails.length === 0
  const emailsInvalid =
    usesAllowlist &&
    (effectiveEmails.length > MAX_ALLOWED_EMAILS ||
      effectiveEmails.some((entry) => validateAllowlistEntry(entry) !== null))

  const emailsDirty =
    draftEmails !== null &&
    JSON.stringify(draftEmails) !== JSON.stringify(saved?.allowedEmails ?? [])
  const isDirty =
    (draftMode !== null && draftMode !== savedAccessMode) ||
    (effectiveMode === 'password' && draftPassword.length > 0) ||
    (usesAllowlist && emailsDirty)
  const primaryAction = saved?.isActive ? (isDirty ? 'update' : 'unshare') : 'share'
  const isUnshareAction = primaryAction === 'unshare'
  const primaryLabel =
    PRIMARY_ACTION_LABELS[primaryAction][upsertShare.isPending ? 'pending' : 'idle']

  const resetDraft = () => {
    setDraftMode(null)
    setDraftPassword('')
    setDraftEmails(null)
  }

  const close = () => {
    setUnshareConfirmOpen(false)
    resetDraft()
    onOpenChange(false)
  }

  /** Settles with the save; a refusal rejects, so the dialog shows its message. */
  const submit = async (action: keyof typeof PRIMARY_ACTION_SUCCESS_MESSAGES) => {
    if (!shareReadReady) return
    const base = { workspaceId, fileId, token: saved ? undefined : generateShortId() }
    const vars =
      action === 'unshare'
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
    await upsertShare.mutateAsync(vars)
    toast.success(PRIMARY_ACTION_SUCCESS_MESSAGES[action])
    setUnshareConfirmOpen(false)
    resetDraft()
  }

  /** The dialog stays open after a share or an update, so the reader can copy the new link. */
  const runPrimaryAction = async () => {
    if (isUnshareAction) {
      setUnshareConfirmOpen(true)
      return false
    }
    await submit(primaryAction)
    return false
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
    !shareReadReady ||
    (!isUnshareAction &&
      (passwordMissing || emailsMissing || emailsInvalid || enableBlockedByPolicy))

  return {
    saved,
    accessHint,
    accessModes: accessModes.map((value) => ({ value, label: ACCESS_LABELS[value] })),
    mode: effectiveMode,
    setMode: setDraftMode,
    password: draftPassword,
    setPassword: setDraftPassword,
    usesAllowlist,
    emails: effectiveEmails,
    setEmails: setDraftEmails,
    emailsError:
      effectiveEmails.length > MAX_ALLOWED_EMAILS
        ? `Add at most ${MAX_ALLOWED_EMAILS} emails or domains.`
        : undefined,
    validateEmail: (entry: string) => validateAllowlistEntry(entry) === null,
    pending: upsertShare.isPending,
    primaryLabel,
    primaryDisabled,
    isUnshareAction,
    runPrimaryAction,
    unshareConfirmOpen,
    setUnshareConfirmOpen,
    confirmUnshare: () => submit('unshare'),
    close,
  }
}
