'use client'

import { Button } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { FailureNotice } from '@sim/emcn/status'
import { Muted } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { SlackSetupWizard } from '@/platform/embedded/app/(shell)/settings/_components/sections/search-slack/slack-setup-wizard'
import { useSlackMemberSetup } from '@/platform/embedded/lib/data/integrations'

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
    appOptions,
    appSetupOpen,
    checkingSetup,
    dismissOnly,
    failure,
    handleOpenChange,
    handleSubmit,
    hidden,
    memberAccountsCopy,
    needsApp,
    pending,
    primaryDisabled,
    primaryLabel,
    selectedApp,
    selectedBotName,
    setAppId,
    setAppSetupOpen,
    sharedAppWithoutBot,
    title,
  } = useSlackMemberSetup({
    organizationId,
    credentialGroupId,
    initialCredentialId,
    initialRequiredScopes,
    onOpenChange,
  })

  if (hidden) return null

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
        ) : failure ? (
          <FailureNotice
            title='Sim Search app'
            message={failure.message}
            retrying={failure.retrying}
            onRetry={failure.retry}
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
            {appOptions.length > 1 ? (
              <SearchableSelect
                label='Sim Search app'
                searchLabel='Search Slack workspaces'
                placeholder='Select the Slack workspace'
                value={selectedApp?.appId ?? null}
                onValueChange={(value) => setAppId(value ?? '')}
                disabled={pending}
                options={appOptions}
              />
            ) : (
              <FieldFrame label='Sim Search app'>
                <Muted>Installed in {selectedApp?.teamName ?? ''}</Muted>
              </FieldFrame>
            )}
            <FieldFrame label='Member accounts'>
              <Muted>
                {dismissOnly
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
          initialName={selectedBotName}
          onClose={() => setAppSetupOpen(false)}
        />
      )}
    </>
  )
}
