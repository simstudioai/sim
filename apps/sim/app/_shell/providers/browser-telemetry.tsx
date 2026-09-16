'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import {
  getStoredMeasurementPermission,
  subscribeStoredMeasurementPermission,
} from '@/lib/consent/measurement-permission'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'
import { startBrowserTelemetry } from '@/lib/telemetry/browser'
import {
  getBrowserTelemetryPreference,
  subscribeBrowserTelemetryPreference,
} from '@/lib/telemetry/browser-preference'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

interface BrowserTelemetryProps {
  disabled: boolean
  consentRequired: boolean
}

interface TelemetryCaptureProps {
  enabled: boolean
  consentRequired: boolean
}

interface AccountTelemetryProps {
  consentRequired: boolean
}

function getServerPreference(): boolean {
  return false
}

function TelemetryCapture({ enabled, consentRequired }: TelemetryCaptureProps) {
  const browserAllowsTelemetry = useSyncExternalStore(
    subscribeBrowserTelemetryPreference,
    getBrowserTelemetryPreference,
    getServerPreference
  )

  useEffect(() => {
    if (enabled && browserAllowsTelemetry) return startBrowserTelemetry(consentRequired)
  }, [enabled, browserAllowsTelemetry, consentRequired])

  return null
}

function AccountTelemetry({ consentRequired }: AccountTelemetryProps) {
  const { data, isError } = useGeneralSettings()
  return (
    <TelemetryCapture
      enabled={!isError && data?.telemetryEnabled === true}
      consentRequired={consentRequired}
    />
  )
}

/** Collects only after session, account preferences, and applicable cookie consent have resolved. */
export function BrowserTelemetry({ disabled, consentRequired }: BrowserTelemetryProps) {
  const { data, isPending, error } = useSession()
  const { isResolved, measurement } = useTrackingConsent()
  const storedPermission = useSyncExternalStore(
    subscribeStoredMeasurementPermission,
    getStoredMeasurementPermission,
    getServerPreference
  )
  if (
    disabled ||
    isPending ||
    error ||
    (consentRequired && (!isResolved || !measurement || !storedPermission))
  ) {
    return null
  }

  return data?.user ? (
    <AccountTelemetry key={data.user.id} consentRequired={consentRequired} />
  ) : (
    <TelemetryCapture enabled consentRequired={consentRequired} />
  )
}
