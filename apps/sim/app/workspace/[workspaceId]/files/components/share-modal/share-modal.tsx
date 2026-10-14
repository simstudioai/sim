'use client'

import { type ComponentType, useState } from 'react'
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
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { useFileShare, useUpsertFileShare } from '@/hooks/queries/public-shares'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  owner: EditableFileOwner
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

interface ShareModalContentProps extends ShareModalProps {
  workspacePolicy?: { canPublish: boolean; allowedAuthTypes: ShareAuthType[] | null }
}

function WorkspaceShareModal(props: ShareModalProps) {
  const { config } = usePermissionConfig()
  return (
    <ShareModalContent
      {...props}
      workspacePolicy={{
        canPublish: !config.disablePublicFileSharing,
        allowedAuthTypes: config.allowedFileShareAuthTypes,
      }}
    />
  )
}

const SHARE_MODAL_ADAPTERS: FileOwnerAdapters<ComponentType<ShareModalProps>> = {
  workspace: WorkspaceShareModal,
  project: ShareModalContent,
}

export function ShareModal(props: ShareModalProps) {
  const Modal = requireFileOwnerAdapter(SHARE_MODAL_ADAPTERS, props.owner)
  return (
    <Modal key={`${props.owner.entityType}:${props.owner.entityId}:${props.fileId}`} {...props} />
  )
}

function ShareModalContent({
  open,
  onOpenChange,
  owner,
  fileId,
  fileName,
  initialShare,
  workspacePolicy,
}: ShareModalContentProps) {
  const {
    data: settings,
    isError: isShareError,
    isFetchedAfterMount,
  } = useFileShare(owner, fileId, { enabled: open })
  const upsertShare = useUpsertFileShare()
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const { features } = useDeploymentShape()

  const share = settings?.share
  const policy = settings?.policy ?? workspacePolicy
  const canWrite = settings?.capabilities?.canWrite ?? owner.entityType === 'workspace'
  const shareReadReady = isFetchedAfterMount && !isShareError
  const saved = shareReadReady ? (share ?? null) : (share ?? initialShare ?? null)
  const savedAccessMode =
    saved?.authType ??
    (owner.entityType === 'project'
      ? (policy?.allowedAuthTypes?.[0] ?? 'public')
      : savedMode(saved))

  const [draftMode, setDraftMode] = useState<ShareAuthType | null>(null)
  const [draftPassword, setDraftPassword] = useState('')
  const [draftEmails, setDraftEmails] = useState<string[] | null>(null)
  const [unshareConfirmOpen, setUnshareConfirmOpen] = useState(false)
  const effectiveMode = draftMode ?? savedAccessMode
  const effectiveEmails = draftEmails ?? saved?.allowedEmails ?? EMPTY_EMAILS

  const allowedAuthTypes = policy?.allowedAuthTypes ?? (workspacePolicy ? null : [])
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
    (!policy?.canPublish && (owner.entityType === 'project' || !saved?.isActive)) || modeDisallowed

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
    if (!shareReadReady || !canWrite || upsertShare.isPending) return

    const base = { owner, fileId, token: saved ? undefined : generateShortId() }
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
    if (!canWrite) return 'You have read-only access to this file.'
    if (modeDisallowed) return 'This sharing method is disabled by an administrator.'
    if (enableBlockedByPolicy)
      return `Public sharing is disabled for this ${owner.entityType === 'project' ? 'Project' : 'workspace'} by an administrator.`
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
              disabled={upsertShare.isPending || !canWrite}
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
                disabled={upsertShare.isPending || !canWrite}
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
              disabled={upsertShare.isPending || !canWrite}
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
                ]
              : undefined
          }
          primaryAction={{
            label: primaryLabel,
            onClick: handlePrimaryAction,
            variant: isUnshareAction ? 'destructive' : 'primary',
            disabled:
              upsertShare.isPending ||
              !shareReadReady ||
              !canWrite ||
              (!isUnshareAction && (passwordMissing || emailsMissing || enableBlockedByPolicy)),
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
