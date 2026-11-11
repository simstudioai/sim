'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { toast } from '@/lib/toast/sink'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import {
  getDesktopBridge,
  useApprovedApps,
  type useComputerUseStatus,
  useRevokeApp,
} from '@/platform/lib/data/desktop'

type ComputerUseState = ReturnType<typeof useComputerUseStatus>

const ACTION_LABELS: Record<string, string> = {
  status: 'Checking permissions',
  list_apps: 'Finding apps',
  get_app_state: 'Reading',
  activate_app: 'Bringing app forward',
  click: 'Clicking',
  type_text: 'Typing',
  input_sequence: 'Entering text and keys',
  press_key: 'Pressing keys',
  scroll: 'Scrolling',
  drag: 'Dragging',
  set_value: 'Editing',
  perform_action: 'Interacting',
}

const PERMISSIONS = [
  {
    key: 'accessibility',
    label: 'Accessibility',
    description: 'Lets Chat click and type in the apps you approve',
  },
  {
    key: 'screenCapture',
    label: 'Screen Recording',
    description: 'Lets Chat see the apps you approve; return here to refresh the status',
  },
] as const

/**
 * The running Computer Use action, with Stop. It shows even after rollout or device access is
 * revoked, so an action can always be stopped.
 */
export function ComputerUseActivity({
  activeAction,
}: {
  activeAction: ComputerUseState['activeAction']
}) {
  if (!activeAction) return null
  return (
    <InlineNotice
      intent='info'
      message={`Computer Use · ${activeAction.appName ?? 'Mac app'} · ${ACTION_LABELS[activeAction.action] ?? 'Working'}`}
      action={
        <Tooltip
          label={
            activeAction.stopShortcutAvailable ? 'Stop computer use (⌘⇧Esc)' : 'Stop computer use'
          }
        >
          <Button
            size='compact'
            icon='I035'
            onClick={() =>
              void getDesktopBridge()
                ?.computerUse?.cancel()
                .catch(() => toast.error('Could not stop computer use'))
            }
          >
            Stop
          </Button>
        </Tooltip>
      }
    />
  )
}

interface ComputerUseSettingsProps {
  /** The `mothership-computer-use` rollout. */
  enabled: boolean
  computerUse: ComputerUseState
}

/** Computer Use on this Mac: the switch, the permissions it needs and the apps it may drive. */
export function ComputerUseSettings({ enabled, computerUse }: ComputerUseSettingsProps) {
  const { status, activeAction, setStatus, refresh, error } = computerUse
  const bridge = getDesktopBridge()?.computerUse
  const shown = Boolean(bridge && enabled && status?.supported !== false)
  const apps = useApprovedApps(activeAction?.appName ?? null, shown)
  const revoke = useRevokeApp()
  const [pending, setPending] = useState(false)

  const update = async (action: () => Promise<void>) => {
    setPending(true)
    try {
      await action()
    } catch {
      toast.error('Could not update Computer Use settings')
    } finally {
      setPending(false)
    }
  }

  if (!bridge || !shown) return null
  const approved = apps.data ?? []
  return (
    <>
      <SettingsSection title='Computer use'>
        <SwitchRow
          label='Let Chat use Mac apps'
          description='Off by default; each app asks for your approval first'
          checked={status?.enabled ?? false}
          disabled={pending || !status}
          onCheckedChange={(checked) =>
            void update(async () => setStatus(await bridge.setEnabled(checked)))
          }
        />
        {error && (
          <FailureNotice
            message='Could not connect to the computer helper'
            onRetry={() => void refresh()}
          />
        )}
        {PERMISSIONS.map((permission) => (
          <SettingsRow
            key={permission.key}
            label={permission.label}
            description={permission.description}
          >
            {status?.permissions[permission.key] ? (
              <StatusTag label='Allowed' intent='success' />
            ) : (
              <Button
                size='compact'
                aria-label={`Open System Settings for ${permission.label}`}
                disabled={pending || !status?.enabled}
                onClick={() =>
                  void update(async () => setStatus(await bridge.requestPermission(permission.key)))
                }
              >
                Open System Settings
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsSection>
      {apps.isError && (
        <FailureNotice
          message='Could not load approved apps'
          retrying={apps.isFetching}
          onRetry={() => void apps.refetch()}
        />
      )}
      {approved.length > 0 && (
        <SettingsSection title='Approved apps'>
          {approved.map((app) => (
            <SettingsRow key={app.bundleId} label={app.displayName} description={app.bundleId}>
              <Button
                size='compact'
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(app.bundleId, {
                    onError: () => toast.error('Could not revoke that app'),
                  })
                }
              >
                Revoke
              </Button>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
    </>
  )
}
