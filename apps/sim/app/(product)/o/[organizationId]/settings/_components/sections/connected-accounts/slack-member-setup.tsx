'use client'

import { Button } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSlackMemberSetup } from '@/platform/lib/data/slack-member-setup'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface SlackMemberSetupProps {
  organizationId: string
  credentialGroupId: string
  onClose: () => void
}

/**
 * Verifies member Slack access for the organization's Sim Search app, as legacy's Credential Groups
 * did. Installing or managing the app opens the Slack Settings page, which owns that setup.
 */
export function SlackMemberSetup({
  organizationId,
  credentialGroupId,
  onClose,
}: SlackMemberSetupProps) {
  const router = useRouter()
  const params = useSearchParams()
  const scope = useSurfaceScope()
  const slackSettings = platformHref(surfaceHref(scope, '/settings/search-slack'), params)
  const setup = useSlackMemberSetup({
    organizationId,
    credentialGroupId,
    onOpenChange: (open) => {
      if (!open) onClose()
    },
  })
  const { dismissOnly, needsApp, selectedApp } = setup

  if (setup.hidden) return null

  return (
    <Modal
      open
      onOpenChange={setup.handleOpenChange}
      title='Set up Slack app'
      cancelLabel={dismissOnly ? 'Close' : undefined}
      confirmLabel={needsApp ? 'Install Sim Search' : dismissOnly ? 'Done' : setup.primaryLabel}
      confirmDisabled={needsApp || dismissOnly ? false : setup.primaryDisabled}
      onConfirm={
        needsApp
          ? () => router.push(slackSettings)
          : dismissOnly
            ? undefined
            : () => {
                void setup.handleSubmit()
                return false
              }
      }
    >
      {setup.checkingSetup ? (
        <FieldFrame label='Sim Search app'>
          <Muted>Checking the installed Slack app…</Muted>
        </FieldFrame>
      ) : setup.failure ? (
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
              <Button
                size='compact'
                disabled={setup.pending}
                render={<Link href={slackSettings} />}
              >
                Manage Sim Search app
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
