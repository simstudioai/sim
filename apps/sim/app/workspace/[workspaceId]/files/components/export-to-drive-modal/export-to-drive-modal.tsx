'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import { GoogleDriveIcon } from '@/components/icons'
import { getProviderIdFromServiceId, getScopesForService, type OAuthProvider } from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { writePendingDriveExport } from '@/app/workspace/[workspaceId]/files/pending-export'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useExportWorkspaceFilesToDrive } from '@/hooks/queries/workspace-files'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const GOOGLE_DRIVE_SERVICE_ID = 'google-drive'
const CONNECT_NEW_VALUE = '__connect_new__'

interface ExportToDriveModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** Workspace file ids to export. */
  fileIds: string[]
  /** File names, used to label the destination hint and success toast. */
  fileNames: string[]
  /**
   * When the modal is resumed after connecting an account, the credential ids
   * that existed beforehand. The account not in this list is the newly-connected
   * one and is auto-selected, so Export is ready even with several accounts.
   */
  priorCredentialIds?: string[]
}

/**
 * Picks a connected Google Drive account and exports the given workspace files
 * to the root of that account's Drive, reusing the same OAuth credentials the
 * Google Drive block uses. Offers an inline "Connect account" path for users
 * who have not connected Google Drive yet.
 */
export function ExportToDriveModal({
  open,
  onOpenChange,
  workspaceId,
  fileIds,
  fileNames,
  priorCredentialIds,
}: ExportToDriveModalProps) {
  const providerId = getProviderIdFromServiceId(GOOGLE_DRIVE_SERVICE_ID) as OAuthProvider

  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const {
    data: credentials = [],
    isLoading: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(providerId, { enabled: open, workspaceId })

  useCredentialRefreshTriggers(refetchCredentials, providerId, workspaceId)

  const { mutate: exportToDrive, isPending } = useExportWorkspaceFilesToDrive()

  const newlyConnectedId = priorCredentialIds
    ? credentials.find((credential) => !priorCredentialIds.includes(credential.id))?.id
    : undefined

  const effectiveCredentialId =
    selectedCredentialId ??
    newlyConnectedId ??
    (credentials.length === 1 ? credentials[0].id : null)

  const accountOptions = [
    ...credentials.map((credential) => ({
      value: credential.id,
      label: credential.name,
      icon: GoogleDriveIcon,
    })),
    {
      value: CONNECT_NEW_VALUE,
      label: credentials.length > 0 ? 'Connect another account' : 'Connect Google Drive account',
      icon: Plus,
    },
  ]

  const handleSelectAccount = (value: string) => {
    if (value === CONNECT_NEW_VALUE) {
      // Connecting triggers a full-page OAuth redirect, so persist the selection
      // (and the current accounts) to resume this export — with the new account
      // auto-selected — when the user returns to Files.
      writePendingDriveExport({
        fileIds,
        fileNames,
        priorCredentialIds: credentials.map((credential) => credential.id),
      })
      setShowOAuthModal(true)
      return
    }
    setSelectedCredentialId(value)
  }

  const handleExport = () => {
    if (!effectiveCredentialId) return
    exportToDrive(
      { workspaceId, fileIds, credentialId: effectiveCredentialId },
      {
        onSuccess: (data) => {
          if (data.exported.length === 0) {
            toast.error(data.failed[0]?.error ?? 'Failed to export to Google Drive')
            return
          }

          const link = data.exported[0].webViewLink
          const summary =
            data.failed.length === 0
              ? `Exported ${data.exported.length} ${data.exported.length === 1 ? 'file' : 'files'} to Google Drive`
              : `Exported ${data.exported.length} of ${data.exported.length + data.failed.length} files to Google Drive`

          toast.success(summary, {
            action: link
              ? { label: 'Open', onClick: () => window.open(link, '_blank') }
              : undefined,
          })
          onOpenChange(false)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  const destinationLabel =
    fileNames.length === 1
      ? `"${fileNames[0]}"`
      : `${fileNames.length} ${fileNames.length === 1 ? 'file' : 'files'}`

  return (
    <>
      <ChipModal open={open} onOpenChange={onOpenChange} size='sm' srTitle='Export to Google Drive'>
        <ChipModalHeader icon={GoogleDriveIcon} onClose={() => onOpenChange(false)}>
          Export to Google Drive
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='dropdown'
            title='Google Drive account'
            required
            value={effectiveCredentialId ?? undefined}
            onChange={handleSelectAccount}
            options={accountOptions}
            placeholder={credentialsLoading ? 'Loading accounts…' : 'Select an account'}
            hint={`${destinationLabel} will be added to the root of your Google Drive.`}
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={isPending}
          primaryAction={{
            label: isPending ? 'Exporting…' : 'Export',
            onClick: handleExport,
            disabled: !effectiveCredentialId || isPending,
          }}
        />
      </ChipModal>
      {showOAuthModal && (
        <ConnectOAuthModal
          mode='connect'
          origin='files'
          open={showOAuthModal}
          onOpenChange={setShowOAuthModal}
          provider={providerId}
          serviceId={GOOGLE_DRIVE_SERVICE_ID}
          providerId={providerId}
          serviceName='Google Drive'
          serviceIcon={GoogleDriveIcon}
          requiredScopes={getScopesForService(GOOGLE_DRIVE_SERVICE_ID)}
          workspaceId={workspaceId}
        />
      )}
    </>
  )
}
