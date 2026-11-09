'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { Tooltip } from '@sim/emcn/tooltip'
import { toast } from '@/lib/toast/sink'
import {
  type ComputerUseAppPermission,
  getDesktopBridge,
  useComputerUseStatus,
} from '@/platform/lib/data/desktop'

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
    description: 'Accessibility allows interaction with approved apps.',
  },
  {
    key: 'screenCapture',
    label: 'Screen Recording',
    description:
      'Screen Recording allows screenshots. Return here after granting access to refresh the status.',
  },
] as const

const ALLOW_LABEL = 'Allow Mothership to use Mac apps'

/**
 * Computer Use on this Mac. The running action stays visible even after rollout or device access is
 * revoked, so it can always be stopped.
 */
export function ComputerUse({ enabled }: { enabled: boolean }) {
  const requestVersion = useRef(0)
  const bridge = getDesktopBridge()?.computerUse
  const { status, activeAction, setStatus, refresh, error } = useComputerUseStatus()
  const [apps, setApps] = useState<ComputerUseAppPermission[]>([])
  const [pending, setPending] = useState(false)

  const refreshApps = async () => {
    if (!bridge) return
    const version = ++requestVersion.current
    try {
      const approved = await bridge.listAppPermissions()
      if (version === requestVersion.current) setApps(approved)
    } catch {
      if (version === requestVersion.current) toast.error('Could not load approved apps')
    }
  }

  useEffect(() => {
    if (!enabled) return
    void refreshApps()
    return () => {
      requestVersion.current += 1
    }
  }, [enabled, bridge, status?.activeAction])

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

  return (
    <>
      {activeAction && (
        <InlineNotice
          intent='info'
          message={`Computer Use · ${activeAction.appName ?? 'Mac app'} · ${ACTION_LABELS[activeAction.action] ?? 'Working'}`}
          action={
            <Tooltip
              label={
                activeAction.stopShortcutAvailable
                  ? 'Stop computer use (⌘⇧Esc)'
                  : 'Stop computer use'
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
      )}
      {bridge && enabled && status?.supported !== false && (
        <>
          <SettingsSection title='Computer Use'>
            <SettingsRow
              label={ALLOW_LABEL}
              description='Off by default. Each app requires your approval. You can stop an action from the conversation or revoke an app below.'
            >
              <Switch
                label={ALLOW_LABEL}
                checked={status?.enabled ?? false}
                disabled={pending || !status}
                onCheckedChange={(checked) =>
                  void update(async () => setStatus(await bridge.setEnabled(checked)))
                }
              />
            </SettingsRow>
            {error && (
              <FailureNotice
                message='Could not connect to the computer helper.'
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
                  <span data-type='T067'>Allowed</span>
                ) : (
                  <Button
                    size='compact'
                    aria-label={`Open System Settings for ${permission.label}`}
                    disabled={pending || !status?.enabled}
                    onClick={() =>
                      void update(async () =>
                        setStatus(await bridge.requestPermission(permission.key))
                      )
                    }
                  >
                    Open System Settings
                  </Button>
                )}
              </SettingsRow>
            ))}
          </SettingsSection>
          {apps.length > 0 && (
            <SettingsSection title='Approved apps'>
              {apps.map((app) => (
                <SettingsRow key={app.bundleId} label={app.displayName} description={app.bundleId}>
                  <Button
                    size='compact'
                    disabled={pending}
                    onClick={() =>
                      void update(async () => {
                        requestVersion.current += 1
                        await bridge.revokeApp(app.bundleId)
                        await refreshApps()
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
      )}
    </>
  )
}
