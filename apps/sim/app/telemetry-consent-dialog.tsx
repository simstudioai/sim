'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { useGeneralStore } from '@/stores/settings/general/store'

declare global {
  interface Window {
    __SIM_TELEMETRY_ENABLED?: boolean
    __SIM_TRACK_EVENT?: (eventName: string, properties?: Record<string, any>) => void
  }
}

const logger = createLogger('TelemetryConsentDialog')

// LocalStorage key for telemetry preferences
const TELEMETRY_NOTIFIED_KEY = 'sim_telemetry_notified'
const TELEMETRY_ENABLED_KEY = 'sim_telemetry_enabled'

const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (typeof window !== 'undefined' && window.__SIM_TELEMETRY_ENABLED) {
    try {
      if (window.__SIM_TRACK_EVENT) {
        window.__SIM_TRACK_EVENT(eventName, properties)
      }
    } catch (error) {
      logger.error(`Failed to track event ${eventName}:`, error)
    }
  }
}

export function TelemetryConsentDialog() {
  const [open, setOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)
  const telemetryNotifiedUser = useGeneralStore((state) => state.telemetryNotifiedUser)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)
  const setTelemetryNotifiedUser = useGeneralStore((state) => state.setTelemetryNotifiedUser)
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  const hasShownDialogThisSession = useRef(false)

  const isChatSubdomainOrPath =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/chat/') ||
      (window.location.hostname !== 'simstudio.ai' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        !window.location.hostname.startsWith('www.')))

  // Check localStorage for saved preferences
  useEffect(() => {
    if (typeof window === 'undefined' || isChatSubdomainOrPath) return

    try {
      const notified = localStorage.getItem(TELEMETRY_NOTIFIED_KEY) === 'true'
      const enabled = localStorage.getItem(TELEMETRY_ENABLED_KEY)

      if (notified) {
        setTelemetryNotifiedUser(true)
      }

      if (enabled !== null) {
        setTelemetryEnabled(enabled === 'true')
      }
    } catch (error) {
      logger.error('Error reading telemetry preferences from localStorage:', error)
    }
  }, [setTelemetryNotifiedUser, setTelemetryEnabled, isChatSubdomainOrPath])

  useEffect(() => {
    // Skip settings loading on chat subdomain pages
    if (isChatSubdomainOrPath) {
      setSettingsLoaded(true)
      return
    }

    let isMounted = true
    const fetchSettings = async () => {
      try {
        await loadSettings(true)
        if (isMounted) {
          setSettingsLoaded(true)
        }
      } catch (error) {
        logger.error('Failed to load settings:', error)
        if (isMounted) {
          setSettingsLoaded(true)
        }
      }
    }

    fetchSettings()

    return () => {
      isMounted = false
    }
  }, [loadSettings, isChatSubdomainOrPath])

  useEffect(() => {
    if (!settingsLoaded || isChatSubdomainOrPath) return

    logger.debug('Settings loaded state:', {
      telemetryNotifiedUser,
      telemetryEnabled,
      hasShownInSession: hasShownDialogThisSession.current,
      environment: isDev,
    })

    const localStorageNotified =
      typeof window !== 'undefined' && localStorage.getItem(TELEMETRY_NOTIFIED_KEY) === 'true'

    // Only show dialog if:
    // 1. Settings are fully loaded from the database
    // 2. User has not been notified yet (according to database AND localStorage)
    // 3. Telemetry is currently enabled (default)
    // 4. Dialog hasn't been shown in this session already (extra protection)
    // 5. We're in development environment
    if (
      settingsLoaded &&
      !telemetryNotifiedUser &&
      !localStorageNotified &&
      telemetryEnabled &&
      !hasShownDialogThisSession.current &&
      isDev
    ) {
      setOpen(true)
      hasShownDialogThisSession.current = true
    } else if (settingsLoaded && !telemetryNotifiedUser && !isDev) {
      // Auto-notify in non-development environments
      setTelemetryNotifiedUser(true)
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(TELEMETRY_NOTIFIED_KEY, 'true')
        } catch (error) {
          logger.error('Error saving telemetry notification to localStorage:', error)
        }
      }
    }
  }, [
    settingsLoaded,
    telemetryNotifiedUser,
    telemetryEnabled,
    setTelemetryNotifiedUser,
    isChatSubdomainOrPath,
  ])

  const handleAccept = () => {
    trackEvent('telemetry_consent_accepted', {
      source: 'consent_dialog',
      defaultEnabled: true,
    })

    setTelemetryNotifiedUser(true)
    setOpen(false)

    // Save preference to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TELEMETRY_NOTIFIED_KEY, 'true')
        localStorage.setItem(TELEMETRY_ENABLED_KEY, 'true')
      } catch (error) {
        logger.error('Error saving telemetry preferences to localStorage:', error)
      }
    }
  }

  const handleDecline = () => {
    trackEvent('telemetry_consent_declined', {
      source: 'consent_dialog',
      defaultEnabled: false,
    })

    setTelemetryEnabled(false)
    setTelemetryNotifiedUser(true)
    setOpen(false)

    // Save preference to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TELEMETRY_NOTIFIED_KEY, 'true')
        localStorage.setItem(TELEMETRY_ENABLED_KEY, 'false')
      } catch (error) {
        logger.error('Error saving telemetry preferences to localStorage:', error)
      }
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className='max-w-md'>
        <AlertDialogHeader>
          <AlertDialogTitle className='mb-2 font-bold text-2xl'>Telemetry</AlertDialogTitle>
        </AlertDialogHeader>

        <div className='space-y-4 text-base text-muted-foreground'>
          <div>
            To help us improve Sim Studio, we collect anonymous usage data by default. This helps us
            understand which features are most useful and identify areas for improvement.
          </div>

          <div className='py-2'>
            <div className='mb-2 font-semibold text-foreground'>We only collect:</div>
            <ul className='list-disc space-y-1 pl-6'>
              <li>Feature usage statistics</li>
              <li>Error reports (without personal info)</li>
              <li>Performance metrics</li>
            </ul>
          </div>

          <div className='py-2'>
            <div className='mb-2 font-semibold text-foreground'>We never collect:</div>
            <ul className='list-disc space-y-1 pl-6'>
              <li>Personal information</li>
              <li>Workflow content or outputs</li>
              <li>API keys or tokens</li>
              <li>IP addresses or location data</li>
            </ul>
          </div>

          <div className='pt-2 text-muted-foreground text-sm'>
            You can change this setting anytime in{' '}
            <span className='font-medium'>Settings → Privacy</span>.
          </div>
        </div>

        <AlertDialogFooter className='mt-4 flex flex-col gap-3 sm:flex-row'>
          <AlertDialogCancel asChild onClick={handleDecline}>
            <Button variant='outline' className='flex-1'>
              Disable telemetry
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild onClick={handleAccept}>
            <Button className='flex-1'>Continue with telemetry</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
