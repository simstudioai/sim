'use client'

import { Button } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { FailureNotice } from '@sim/emcn/status'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { LiveSlackSetup } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/live-slack-setup'
import { useSlackMemberSetup } from '@/platform/lib/data/slack-member-setup'

interface SlackMemberSetupProps {
  organizationId: string
  credentialGroupId: string
  onClose: () => void
}

/**
 * Verifies member Slack access for the organization's Sim Search app, as legacy's Credential Groups
 * did. Installing or managing the app opens Slack Settings' setup dialog over this one, which picks
 * up the new installation once it closes.
 */
export function SlackMemberSetup({
  organizationId,
  credentialGroupId,
  onClose,
}: SlackMemberSetupProps) {
  const setup = useSlackMemberSetup({
    organizationId,
    credentialGroupId,
    onOpenChange: (open) => {
      if (!open) onClose()
    },
  })
  const { appSetup, dismissOnly, needsApp, selectedApp } = setup

  if (setup.hidden) return null

  return (
    <>
      <Modal
        open
        onOpenChange={setup.handleOpenChange}
        title='Set up Slack app'
        cancelLabel={dismissOnly ? 'Close' : undefined}
        confirmLabel={needsApp ? 'Install Sim Search' : dismissOnly ? 'Done' : setup.primaryLabel}
        confirmDisabled={needsApp || dismissOnly ? false : setup.primaryDisabled}
        onConfirm={
          needsApp
            ? () => {
                setup.openAppSetup()
                return false
              }
            : dismissOnly
              ? undefined
              : () => {
                  void setup.handleSubmit()
                  return false
                }
        }
      >
        {setup.checkingSetup ? null : setup.failure ? (
          <FailureNotice
            title='Sim Search app'
            message={setup.failure.message}
            retrying={setup.failure.retrying}
            onRetry={setup.failure.retry}
          />
        ) : setup.sharedAppWithoutBot ? (
          <FieldFrame label='Member accounts'>
            <Muted>{setup.memberAccountsCopy}</Muted>
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
            {setup.appOptions.length > 1 ? (
              <SearchableSelect
                label='Sim Search app'
                searchLabel='Search Slack workspaces'
                placeholder='Select the Slack workspace'
                value={selectedApp?.appId ?? null}
                onValueChange={(value) => setup.setAppId(value ?? '')}
                disabled={setup.pending}
                options={setup.appOptions}
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
                <Button size='compact' disabled={setup.pending} onClick={setup.openAppSetup}>
                  Manage Sim Search app
                </Button>
              </div>
            )}
          </>
        )}
      </Modal>
      {appSetup && (
        <LiveSlackSetup
          key={appSetup.target.previous?.id ?? 'new'}
          organizationId={organizationId}
          target={appSetup.target}
          botName={appSetup.botName}
          close={appSetup.close}
        />
      )}
    </>
  )
}
