'use client'

import {
  ButtonGroup,
  ButtonGroupItem,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipPasswordInput,
  TagInput,
  type TagItem,
} from '@sim/emcn'
import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import { generatePassword } from '@/lib/core/security/encryption'
import {
  type ShareableResourceType,
  useResourceShare,
  useUpsertResourceShare,
} from '@/hooks/queries/public-shares'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import {
  SHARE_ACCESS_LABELS,
  type ShareAccessMode,
  useShareModalState,
} from '@/hooks/use-share-modal-state'

interface AccessCopy {
  private: string
  password: string
  email: string
  sso: string
  publicSaved: string
  publicUnsaved: string
}

/** Access-hint copy per resource family — the only wording that differs between them. */
const ACCESS_COPY: Record<ShareableResourceType, AccessCopy> = {
  file: {
    private: 'Only workspace members can access this file.',
    password: 'Anyone with the link and the password can view and download this file.',
    email: 'Only allowed emails can access this file after a one-time code.',
    sso: 'Only allowed emails signed in via SSO can access this file.',
    publicSaved: 'Anyone with the link can view and download this file.',
    publicUnsaved: 'Save to make this file accessible to anyone with the link.',
  },
  interface: {
    private: 'Only workspace members can access this interface.',
    password: 'Anyone with the link and the password can use this interface.',
    email: 'Only allowed emails can use this interface after a one-time code.',
    sso: 'Only allowed emails signed in via SSO can use this interface.',
    publicSaved: 'Anyone with the link can use this interface.',
    publicUnsaved: 'Save to make this interface accessible to anyone with the link.',
  },
}

export interface ShareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** Which resource family is being shared — drives the endpoints, policy gates, and hint copy. */
  resourceType: ShareableResourceType
  resourceId: string
  /** Display name, used for the screen-reader title. */
  resourceName: string
  /** Share state already known from the list row, used as the initial value to avoid flicker. */
  initialShare?: ShareRecord | null
}

/**
 * THE share dialog — one component for every shareable resource (files,
 * interfaces), so the chrome, state machine, and save flow cannot drift between
 * them. Everything resource-specific comes in through props: the endpoints and
 * policy gates branch on `resourceType`, the hint copy reads from
 * {@link ACCESS_COPY}, and callers that already know the share state pass
 * `initialShare` to avoid a loading flicker.
 *
 * Saving never navigates. The public link is surfaced in-place by the copyable
 * `Link` field — which reads the pre-reserved token, so it is present and
 * correct before the first save — rather than by opening a tab, which popup
 * blockers eat outside the user-activation window and which would fire again on
 * every unrelated re-save (a password rotation, an allowed-emails edit).
 */
export function ShareModal({
  open,
  onOpenChange,
  workspaceId,
  resourceType,
  resourceId,
  resourceName,
  initialShare,
}: ShareModalProps) {
  const { data: share, isFetched } = useResourceShare(resourceType, workspaceId, resourceId, {
    enabled: open,
  })
  const { config: permissionConfig } = usePermissionConfig()
  const upsertShare = useUpsertResourceShare()

  const saved = share ?? initialShare ?? null
  const {
    mode,
    setMode,
    availableModes,
    password,
    setPassword,
    emails,
    addEmail,
    removeEmail,
    shareUrl,
    isDirty,
    modeDisallowed,
    enableBlockedByPolicy,
    canSave,
    buildSavePayload,
    reset,
  } = useShareModalState({
    resourceType,
    saved,
    isFetched,
    policy:
      resourceType === 'file'
        ? {
            disablePublicSharing: permissionConfig.disablePublicFileSharing,
            allowedAuthTypes: permissionConfig.allowedFileShareAuthTypes,
          }
        : {
            disablePublicSharing: permissionConfig.disablePublicInterfaceSharing,
            allowedAuthTypes: permissionConfig.allowedInterfaceShareAuthTypes,
          },
  })

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleSave = () => {
    upsertShare.mutate(
      { resourceType, workspaceId, resourceId, ...buildSavePayload() },
      {
        onSuccess: () => {
          reset()
          onOpenChange(false)
        },
      }
    )
  }

  const copy = ACCESS_COPY[resourceType]
  const accessHint = (() => {
    if (modeDisallowed) return 'This sharing method is disabled by an administrator.'
    if (enableBlockedByPolicy)
      return 'Public sharing is disabled for this workspace by an administrator.'
    if (mode === 'private') return copy.private
    if (mode === 'password') return copy.password
    if (mode === 'email') return copy.email
    if (mode === 'sso') return copy.sso
    return isDirty ? copy.publicUnsaved : copy.publicSaved
  })()

  const emailItems: TagItem[] = emails.map((value) => ({ value, isValid: true }))

  return (
    <ChipModal open={open} onOpenChange={handleClose} size='sm' srTitle={`Share ${resourceName}`}>
      <ChipModalHeader onClose={handleClose}>Share {resourceType}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Access' hint={accessHint}>
          <ButtonGroup
            value={mode}
            onValueChange={(value) => setMode(value as ShareAccessMode)}
            aria-label='Share access'
          >
            {availableModes.map((accessMode) => (
              <ButtonGroupItem key={accessMode} value={accessMode}>
                {SHARE_ACCESS_LABELS[accessMode]}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        </ChipModalField>
        {mode === 'password' ? (
          <ChipModalField
            type='custom'
            title='Password'
            hint={saved?.hasPassword ? 'Leave blank to keep the current password.' : undefined}
          >
            <ChipPasswordInput
              value={password}
              onChange={setPassword}
              onGenerate={() => generatePassword(24)}
              placeholder={saved?.hasPassword ? '••••••••' : 'Enter a password'}
            />
          </ChipModalField>
        ) : null}
        {mode === 'email' || mode === 'sso' ? (
          <ChipModalField
            type='custom'
            title='Allowed emails'
            hint='Add specific emails or whole domains (@example.com).'
          >
            <TagInput
              items={emailItems}
              onAdd={addEmail}
              onRemove={removeEmail}
              placeholder='Enter emails or domains'
              placeholderWithTags='Add email'
            />
          </ChipModalField>
        ) : null}
        {mode !== 'private' && shareUrl ? (
          <ChipModalField type='copy' title='Link' value={shareUrl} copyLabel='Copy link' />
        ) : null}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        primaryAction={{
          label: upsertShare.isPending ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: !canSave || upsertShare.isPending,
        }}
      />
    </ChipModal>
  )
}
