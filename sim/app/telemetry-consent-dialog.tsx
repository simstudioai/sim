'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useGeneralStore } from '@/stores/settings/general/store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TelemetryConsentDialog')

export function TelemetryConsentDialog() {
  const [open, setOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const telemetryEnabled = useGeneralStore(state => state.telemetryEnabled)
  const telemetryNotifiedUser = useGeneralStore(state => state.telemetryNotifiedUser)
  const setTelemetryEnabled = useGeneralStore(state => state.setTelemetryEnabled)
  const setTelemetryNotifiedUser = useGeneralStore(state => state.setTelemetryNotifiedUser)
  const loadSettings = useGeneralStore(state => state.loadSettings)
  
  const hasShownDialogThisSession = useRef(false)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        await loadSettings(true)
        setSettingsLoaded(true)
      } catch (error) {
        logger.error('Failed to load settings:', error)
        setSettingsLoaded(true)
      }
    }
    
    fetchSettings()
  }, [loadSettings])

  // Show dialog when settings are properly loaded from the database
  useEffect(() => {
    // Only proceed if settings are fully loaded from the database
    if (!settingsLoaded) return
    
    logger.debug('Settings loaded state:', { 
      telemetryNotifiedUser, 
      telemetryEnabled, 
      hasShownInSession: hasShownDialogThisSession.current
    })
    
    // Only show dialog if:
    // 1. Settings are fully loaded from the database
    // 2. User has not been notified yet (according to database)
    // 3. Telemetry is currently enabled (default)
    // 4. Dialog hasn't been shown in this session already (extra protection)
    if (settingsLoaded && !telemetryNotifiedUser && telemetryEnabled && !hasShownDialogThisSession.current) {
      setOpen(true)
      hasShownDialogThisSession.current = true
    }
  }, [settingsLoaded, telemetryNotifiedUser, telemetryEnabled])

  const handleAccept = () => {
    setTelemetryNotifiedUser(true)
    setOpen(false)
  }

  const handleDecline = () => {
    setTelemetryEnabled(false)
    setTelemetryNotifiedUser(true)
    setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-2xl font-bold mb-2">Telemetry</AlertDialogTitle>
        </AlertDialogHeader>
        
        <div className="space-y-4 text-base text-muted-foreground">
          <div>
            To help us improve Sim Studio, we collect anonymous usage
            data by default. This helps us understand which features are
            most useful and identify areas for improvement.
          </div>
          
          <div className="py-2">
            <div className="font-semibold text-foreground mb-2">We only collect:</div>
            <ul className="list-disc pl-6 space-y-1">
              <li>Feature usage statistics</li>
              <li>Error reports (without personal info)</li>
              <li>Performance metrics</li>
            </ul>
          </div>
          
          <div className="py-2">
            <div className="font-semibold text-foreground mb-2">We never collect:</div>
            <ul className="list-disc pl-6 space-y-1">
              <li>Personal information</li>
              <li>Workflow content or outputs</li>
              <li>API keys or tokens</li>
              <li>IP addresses or location data</li>
            </ul>
          </div>
          
          <div className="text-sm text-muted-foreground pt-2">
            You can change this setting anytime in{' '}
            <span className="font-medium">Settings → Privacy</span>.
          </div>
        </div>

        <AlertDialogFooter className="flex flex-col sm:flex-row gap-3 mt-4">
          <AlertDialogCancel asChild onClick={handleDecline}>
            <Button variant="outline" className="flex-1">
              Disable telemetry
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild onClick={handleAccept}>
            <Button className="flex-1">
              Continue with telemetry
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
} 