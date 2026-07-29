'use client'

import { useCallback, useEffect, useState } from 'react'
import { BROWSER_DATA_KINDS, type BrowserDataKind } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata, DesktopPreferences } from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { PasswordsView } from '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface DataRow {
  kind: BrowserDataKind
  label: string
  action: string
  /**
   * What the user actually loses. Not shown in the row — the action names
   * itself — but spelled out in the confirmation, where it matters.
   */
  consequence: string
}

/**
 * Download history is deliberately absent: the built-in browser cancels every
 * download, so there is none to clear.
 */
const DATA_ROWS: DataRow[] = [
  {
    kind: 'cookies',
    label: 'Cookies',
    action: 'Delete cookies',
    consequence: 'sign the browser out of every site it is currently signed into',
  },
  {
    kind: 'site-data',
    label: 'Site data',
    action: 'Delete site data',
    consequence: 'erase the data sites have stored locally, such as drafts and preferences',
  },
  {
    kind: 'cache',
    label: 'Cached images and files',
    action: 'Delete cached images and files',
    consequence: 'free up space and make sites load more slowly the first time',
  },
]

export function Browser() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [siteCount, setSiteCount] = useState(0)
  const [togglePending, setTogglePending] = useState(false)
  const [credentials, setCredentials] = useState<BrowserCredentialMetadata[]>([])
  const [showPasswords, setShowPasswords] = useState(false)
  const [confirming, setConfirming] = useState<DataRow | 'all' | null>(null)
  const [clearPending, setClearPending] = useState(false)

  const refreshSiteCount = useCallback(async () => {
    const known = await getDesktopBridge()?.browserAgent?.getKnownSessions?.()
    setSiteCount(known?.sessions.length ?? 0)
  }, [])

  const refreshCredentials = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge) return
    const available = await bridge.isAvailable().catch(() => false)
    setCredentials(available ? await bridge.list().catch(() => []) : [])
  }, [])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.browserAgent || !bridge.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([bridge.settings.getPreferences(), refreshSiteCount(), refreshCredentials()])
      .then(([next]) => setPreferences(next))
      .catch(() => toast.error('Could not load browser settings'))
  }, [refreshCredentials, refreshSiteCount, router, workspaceId])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const setBrowserEnabled = getDesktopBridge()?.settings?.setBrowserEnabled
    if (!setBrowserEnabled) return
    setTogglePending(true)
    try {
      const next = await setBrowserEnabled(enabled)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update browser settings')
    } finally {
      setTogglePending(false)
    }
  }, [])

  const clear = useCallback(async (kinds: readonly BrowserDataKind[]) => {
    const clearBrowsingData = getDesktopBridge()?.browserAgent?.clearBrowsingData
    if (!clearBrowsingData) return
    setClearPending(true)
    try {
      setSiteCount((await clearBrowsingData(kinds)).sessions.length)
      setConfirming(null)
    } catch {
      toast.error('Could not delete browsing data')
    } finally {
      setClearPending(false)
    }
  }, [])

  if (!preferences) {
    return null
  }

  if (showPasswords) {
    return (
      <PasswordsView
        credentials={credentials}
        onChange={setCredentials}
        onBack={() => setShowPasswords(false)}
        onImported={() => Promise.all([refreshSiteCount(), refreshCredentials()])}
      />
    )
  }

  const enabled = preferences.browserEnabled ?? true
  const canClearData = typeof getDesktopBridge()?.browserAgent?.clearBrowsingData === 'function'
  const canManagePasswords = Boolean(getDesktopBridge()?.browserCredentials)
  const target = confirming === 'all' ? null : confirming

  return (
    <>
      <SettingsPanel
        actions={[
          ...(canManagePasswords
            ? [{ text: 'Passwords', onSelect: () => setShowPasswords(true) }]
            : []),
          ...(canClearData
            ? [
                {
                  text: 'Clear all',
                  variant: 'destructive' as const,
                  onSelect: () => setConfirming('all'),
                  disabled: clearPending,
                },
              ]
            : []),
        ]}
      >
        <SettingsSection label='Agent browser'>
          <div className='flex items-center justify-between'>
            <div className='flex flex-col gap-1'>
              <Label htmlFor='browser-enabled'>Let Chat browse the web</Label>
              <p className='text-[var(--text-muted)] text-caption'>
                Pages open in a browser built into Sim, signed in separately from your own.
              </p>
            </div>
            <Switch
              id='browser-enabled'
              checked={enabled}
              disabled={togglePending}
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </div>
        </SettingsSection>

        {canClearData &&
          DATA_ROWS.map((row) => (
            <SettingsSection
              key={row.kind}
              label={row.label}
              action={
                <Chip disabled={clearPending} onClick={() => setConfirming(row)}>
                  {row.action}
                </Chip>
              }
            >
              {null}
            </SettingsSection>
          ))}

        {canClearData && (
          <p className='text-[var(--text-muted)] text-caption'>
            {siteCount === 0
              ? 'Nothing saved. Sites you sign into in the browser stay on this device.'
              : `${siteCount} ${siteCount === 1 ? 'site is' : 'sites are'} signed in or holding cookies, saved on this device only.`}{' '}
            Saved passwords are never deleted here.
          </p>
        )}
      </SettingsPanel>

      <ChipConfirmModal
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={target ? target.action : 'Clear all browsing data'}
        text={[
          'This will ',
          {
            text: target
              ? target.consequence
              : 'sign the browser out of every site and erase its cookies, site data, and cache',
            bold: true,
          },
          '. Your Sim account and saved passwords are not affected.',
        ]}
        confirm={{
          label: target ? target.action : 'Clear all',
          pending: clearPending,
          pendingLabel: 'Deleting...',
          onClick: () => void clear(target ? [target.kind] : BROWSER_DATA_KINDS),
        }}
      />
    </>
  )
}
