'use client'

import { Muted } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { SlackSetupWizard } from '@/platform/app/(shell)/settings/_components/sections/search-slack/slack-setup-wizard'
import {
  Button,
  FailureNotice,
  FieldFrame,
  Modal,
  SelectField,
} from '@/platform/design-system/components'
import { useSlackManagedUsersSetup } from '@/platform/lib/data/credential-groups'

interface SlackMemberSetupModalProps {
  organizationId: string
  credentialGroupId: string
  initialCredentialId?: string
  initialRequiredScopes?: readonly string[]
  onOpenChange: (open: boolean) => void
}

/** Verifies member Slack access for an organization's Sim Search app. */
export function SlackMemberSetupModal({
  organizationId,
  credentialGroupId,
  initialCredentialId,
  initialRequiredScopes,
  onOpenChange,
}: SlackMemberSetupModalProps) {
  const {
    apps,
    appSetupOpen,
    availableApps,
    checkingSetup,
    failedSetup,
    handleOpenChange,
    handleSubmit,
    memberAccountsCopy,
    needsApp,
    pending,
    primaryDisabled,
    primaryLabel,
    selectedApp,
    setAppId,
    setAppSetupOpen,
    sharedAppInstalled,
    sharedAppNeedsUpdate,
    sharedAppReady,
    sharedAppWithoutBot,
    title,
  } = useSlackManagedUsersSetup({
    open: true,
    organizationId,
    credentialGroupId,
    bots: [],
    isLoading: false,
    initialCredentialId,
    initialRequiredScopes,
    onOpenChange,
  })

  if (sharedAppReady && !appSetupOpen) return null

  const dismissOnly = sharedAppInstalled && !sharedAppNeedsUpdate
  return (
    <>
      <Modal
        open={!appSetupOpen}
        onOpenChange={handleOpenChange}
        title={title}
        cancelLabel={dismissOnly ? 'Close' : undefined}
        confirmLabel={needsApp ? 'Install Sim Search' : dismissOnly ? 'Done' : primaryLabel}
        confirmDisabled={needsApp || dismissOnly ? false : primaryDisabled}
        onConfirm={
          needsApp
            ? () => {
                setAppSetupOpen(true)
                return false
              }
            : dismissOnly
              ? undefined
              : () => {
                  void handleSubmit()
                  return false
                }
        }
      >
        {checkingSetup ? (
          <FieldFrame label='Sim Search app'>
            <Muted>Checking the installed Slack app…</Muted>
          </FieldFrame>
        ) : failedSetup ? (
          <FailureNotice
            title='Sim Search app'
            message={failedSetup.error?.message ?? 'Could not check the Slack app'}
            retrying={failedSetup.isFetching}
            onRetry={() => void failedSetup.refetch()}
          />
        ) : sharedAppWithoutBot ? (
          <FieldFrame label='Member accounts'>
            <Muted>{memberAccountsCopy}</Muted>
          </FieldFrame>
        ) : needsApp ? (
          <FieldFrame label='Install Sim Search first'>
            <Muted>
              Install the Sim Search app in your Slack workspace to use the bot and connect Slack
              accounts.
            </Muted>
          </FieldFrame>
        ) : (
          <>
            {availableApps.length > 1 ? (
              <SelectField
                label='Sim Search app'
                value={selectedApp?.appId}
                onValueChange={setAppId}
                disabled={pending}
                options={availableApps.map((app) => ({ value: app.appId, label: app.teamName }))}
              />
            ) : (
              <FieldFrame label='Sim Search app'>
                <Muted>Installed in {selectedApp?.teamName ?? ''}</Muted>
              </FieldFrame>
            )}
            <FieldFrame label='Member accounts'>
              <Muted>
                {sharedAppInstalled && !sharedAppNeedsUpdate
                  ? 'The Sim Search installation needs attention. Manage the app to finish setup.'
                  : 'Verify member permissions. Members will need to reconnect if their app or permissions change.'}
              </Muted>
            </FieldFrame>
            {selectedApp && (
              <div>
                <Button size='compact' disabled={pending} onClick={() => setAppSetupOpen(true)}>
                  Manage Sim Search app
                </Button>
              </div>
            )}
          </>
        )}
      </Modal>
      {appSetupOpen && (
        <SlackSetupWizard
          organizationId={organizationId}
          installationId={selectedApp?.id}
          appId={selectedApp?.appId}
          initialName={
            apps.data?.bots.find((bot) => bot.id === selectedApp?.credentialId)?.displayName
          }
          onClose={() => setAppSetupOpen(false)}
        />
      )}
    </>
  )
}
