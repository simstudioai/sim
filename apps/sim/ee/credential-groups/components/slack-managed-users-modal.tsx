'use client'

import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Skeleton,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { SlackIcon } from '@/components/icons'
import { SlackSearchSetupWizard } from '@/components/integrations/slack-search-setup-wizard'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'
import {
  type SlackManagedUsersSetupOptions,
  useSlackManagedUsersSetup,
} from '@/ee/credential-groups/hooks/use-slack-managed-users-setup'

interface SlackManagedUsersModalProps extends SlackManagedUsersSetupOptions {
  error: Error | null
}

export function SlackManagedUsersModal({ error, ...options }: SlackManagedUsersModalProps) {
  const { bots, isLoading, open } = options
  const {
    apps,
    appSetupOpen,
    availableApps,
    checkingSetup,
    clientId,
    clientSecret,
    effectiveAccess,
    effectiveCredentialId,
    failedSetup,
    handleOpenChange,
    handleSelectBot,
    handleSubmit,
    memberAccountsCopy,
    needsApp,
    noBots,
    organizationSetup,
    pending,
    primaryDisabled,
    primaryLabel,
    scope,
    selectedApp,
    selectedBot,
    setAccess,
    setAppId,
    setAppSetupOpen,
    setClientId,
    setClientSecret,
    setSelectedCredentialId,
    sharedAppInstalled,
    sharedAppNeedsUpdate,
    sharedAppReady,
    sharedAppWithoutBot,
    title,
  } = useSlackManagedUsersSetup(options)

  if (sharedAppReady && !appSetupOpen) return null

  return (
    <>
      <ChipModal
        open={open && !appSetupOpen}
        onOpenChange={handleOpenChange}
        srTitle={title}
        size='md'
      >
        <ChipModalHeader icon={SlackIcon} onClose={() => handleOpenChange(false)}>
          {title}
        </ChipModalHeader>
        <ChipModalBody>
          {organizationSetup ? (
            checkingSetup ? (
              <ChipModalField type='custom' title='Sim Search app'>
                <p role='status' className='text-[var(--text-secondary)] text-sm'>
                  Checking the installed Slack app…
                </p>
              </ChipModalField>
            ) : failedSetup ? (
              <ChipModalField
                type='custom'
                title='Sim Search app'
                error={failedSetup.error?.message}
              >
                <Chip onClick={() => void failedSetup.refetch()} disabled={failedSetup.isFetching}>
                  Retry
                </Chip>
              </ChipModalField>
            ) : sharedAppWithoutBot ? (
              <ChipModalField type='custom' title='Member accounts'>
                <p className='text-[var(--text-secondary)] text-sm'>{memberAccountsCopy}</p>
              </ChipModalField>
            ) : needsApp ? (
              <ChipModalField type='custom' title='Install Sim Search first'>
                <p className='text-[var(--text-secondary)] text-sm'>
                  Install the Sim Search app in your Slack workspace to use the bot and connect
                  Slack accounts.
                </p>
              </ChipModalField>
            ) : (
              <>
                {availableApps.length > 1 ? (
                  <ChipModalField
                    type='dropdown'
                    title='Sim Search app'
                    value={selectedApp?.appId}
                    onChange={setAppId}
                    disabled={pending}
                    options={availableApps.map((app) => ({
                      value: app.appId,
                      label: app.teamName,
                      icon: SlackIcon,
                    }))}
                    placeholder='Select the Slack workspace'
                    required
                  />
                ) : (
                  <ChipModalField type='custom' title='Sim Search app'>
                    <p className='text-[var(--text-body)] text-sm'>
                      Installed in {selectedApp?.teamName}
                    </p>
                  </ChipModalField>
                )}
                <ChipModalField type='custom' title='Member accounts'>
                  <p className='text-[var(--text-secondary)] text-sm'>
                    {sharedAppInstalled
                      ? sharedAppNeedsUpdate
                        ? 'Verify member permissions. Members will need to reconnect if their app or permissions change.'
                        : 'The Sim Search installation needs attention. Manage the app to finish setup.'
                      : 'Verify member permissions. Members will need to reconnect if their app or permissions change.'}
                  </p>
                  {selectedApp && (
                    <Chip onClick={() => setAppSetupOpen(true)} disabled={pending}>
                      Manage Sim Search app
                    </Chip>
                  )}
                </ChipModalField>
              </>
            )
          ) : isLoading ? (
            <div className='flex flex-col gap-[9px] px-2'>
              <Skeleton className='h-4 w-24 rounded' />
              <Skeleton className='h-[30px] w-full rounded-lg' />
            </div>
          ) : noBots ? (
            <ChipModalField
              type='custom'
              title='Slack app'
              hint='Set up a Slack app so members can connect their accounts.'
            >
              <Chip onClick={() => setAppSetupOpen(true)}>Set up Slack app</Chip>
            </ChipModalField>
          ) : (
            <>
              <ChipModalField
                type='dropdown'
                title='Slack app'
                value={effectiveCredentialId || undefined}
                onChange={handleSelectBot}
                options={bots.map((bot) => ({
                  value: bot.id,
                  label: bot.displayName,
                  icon: SlackIcon,
                }))}
                placeholder='Select a Slack app'
                disabled={pending}
                required
              />
              {selectedBot ? (
                <>
                  {scope.kind === 'workspace' && (
                    <ChipModalField
                      type='dropdown'
                      title='Access'
                      value={effectiveAccess}
                      onChange={(value) => {
                        if (value === 'search' || value === 'workflow') setAccess(value)
                      }}
                      options={[
                        { value: 'search', label: 'Search documents' },
                        { value: 'workflow', label: 'Workflow tools' },
                      ]}
                      hint={
                        effectiveAccess === 'search'
                          ? 'Read messages members can access. Changing access requires members to reconnect.'
                          : 'Read and write Slack content for workflows. Changing access requires members to reconnect.'
                      }
                      disabled={pending}
                    />
                  )}
                  <ChipModalField
                    type='input'
                    title='Client ID'
                    value={clientId}
                    onChange={setClientId}
                    placeholder='Paste the Client ID'
                    autoComplete='off'
                    disabled={pending}
                    required
                  />
                  <ChipModalField
                    type='input'
                    inputType='password'
                    title='Client Secret'
                    value={clientSecret}
                    onChange={setClientSecret}
                    placeholder='Paste the Client Secret'
                    autoComplete='off'
                    disabled={pending}
                    required
                  />
                </>
              ) : null}
            </>
          )}
          <ChipModalError>{error ? getErrorMessage(error) : null}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => handleOpenChange(false)}
          {...(needsApp
            ? {
                primaryAction: {
                  label: 'Install Sim Search',
                  onClick: () => setAppSetupOpen(true),
                },
              }
            : sharedAppInstalled && !sharedAppNeedsUpdate
              ? { defaultAction: 'dismiss' as const }
              : noBots
                ? { defaultAction: 'dismiss' as const }
                : {
                    primaryAction: {
                      label: primaryLabel,
                      onClick: () => void handleSubmit(),
                      disabled: primaryDisabled,
                    },
                  })}
        />
      </ChipModal>
      {open &&
        appSetupOpen &&
        (scope.kind === 'organization' ? (
          <SlackSearchSetupWizard
            organizationId={scope.organizationId}
            installationId={selectedApp?.id}
            appId={selectedApp?.appId}
            initialName={
              apps.data?.bots.find((bot) => bot.id === selectedApp?.credentialId)?.displayName
            }
            onClose={() => setAppSetupOpen(false)}
          />
        ) : (
          <ConnectSlackBotModal
            open
            onOpenChange={setAppSetupOpen}
            workspaceId={scope.workspaceId}
            onCreated={setSelectedCredentialId}
          />
        ))}
    </>
  )
}
