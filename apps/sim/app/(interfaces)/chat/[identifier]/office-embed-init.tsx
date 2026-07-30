'use client'

import Script from 'next/script'

declare global {
  interface Window {
    Office?: {
      onReady: () => Promise<{ host: string | null; platform: string | null }>
    }
  }
}

/**
 * Office.js nullifies window.history.replaceState and pushState (a legacy
 * IE10 workaround inside the library) which breaks Next.js's client-side
 * router. Cache the originals at module load — before <Script> renders
 * Office.js into the DOM — so we can restore them after it loads.
 *
 * See https://learn.microsoft.com/en-us/answers/questions/1070090/using-office-javascript-api-in-next-js.
 */
const cachedHistory =
  typeof window !== 'undefined'
    ? {
        replaceState: window.history.replaceState.bind(window.history),
        pushState: window.history.pushState.bind(window.history),
      }
    : null

/**
 * Loads Office.js and signals readiness so Office host applications
 * (Excel, Word, PowerPoint, Outlook) recognize this page as a valid add-in.
 *
 * Office.onReady() must be called once Office.js is loaded — see
 * https://learn.microsoft.com/en-us/javascript/api/office#office-office-onready-function(1).
 */
export function OfficeEmbedInit() {
  return (
    <Script
      src='https://appsforoffice.microsoft.com/lib/1/hosted/office.js'
      strategy='afterInteractive'
      onReady={() => {
        if (cachedHistory) {
          window.history.replaceState = cachedHistory.replaceState
          window.history.pushState = cachedHistory.pushState
        }
        void window.Office?.onReady()
      }}
    />
  )
}
