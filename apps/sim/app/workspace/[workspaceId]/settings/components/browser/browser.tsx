'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesktopPreferences } from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

export function Browser() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [siteCount, setSiteCount] = useState(0)
  const [togglePending, setTogglePending] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearPending, setClearPending] = useState(false)

  const refreshSiteCount = useCallback(async () => {
    const known = await getDesktopBridge()?.browserAgent?.getKnownSessions?.()
    setSiteCount(known?.sessions.length ?? 0)
  }, [])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.browserAgent || !bridge.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([bridge.settings.getPreferences(), refreshSiteCount()])
      .then(([next]) => setPreferences(next))
      .catch(() => toast.error('Could not load browser settings'))
  }, [refreshSiteCount, router, workspaceId])

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

  const clearBrowsingData = useCallback(async () => {
    const clear = getDesktopBridge()?.browserAgent?.clearBrowsingData
    if (!clear) return
    setClearPending(true)
    try {
      setSiteCount((await clear()).sessions.length)
      setConfirmingClear(false)
    } catch {
      toast.error('Could not clear browsing data')
    } finally {
      setClearPending(false)
    }
  }, [])

  if (!preferences) {
    return null
  }

  const enabled = preferences.browserEnabled ?? true
  const canClear = typeof getDesktopBridge()?.browserAgent?.clearBrowsingData === 'function'

  return (
    <>
      <SettingsPanel>
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

        <SettingsSection
          label='Browsing data'
          action={
            canClear ? (
              <Chip onClick={() => setConfirmingClear(true)} disabled={siteCount === 0}>
                Clear browsing data
              </Chip>
            ) : undefined
          }
        >
          <p className='text-[var(--text-muted)] text-caption'>
            {siteCount === 0
              ? 'Nothing saved. Sites you sign into in the browser stay on this device.'
              : `${siteCount} ${siteCount === 1 ? 'site is' : 'sites are'} signed in or holding cookies, saved on this device only.`}
          </p>
        </SettingsSection>
      </SettingsPanel>

      <ChipConfirmModal
        open={confirmingClear}
        onOpenChange={(open) => !open && setConfirmingClear(false)}
        title='Clear browsing data'
        text={[
          'This signs the browser out of every site and erases its cookies, storage, and cache. Your ',
          { text: 'Sim account', bold: true },
          ' is not affected.',
        ]}
        confirm={{
          label: 'Clear browsing data',
          pending: clearPending,
          pendingLabel: 'Clearing...',
          onClick: () => void clearBrowsingData(),
        }}
      />
    </>
  )
}
