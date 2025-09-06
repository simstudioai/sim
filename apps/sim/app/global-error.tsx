'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import NextError from 'next/error'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('GlobalError')

export default function GlobalError({ 
  error, 
  reset 
}: { 
  error: Error & { digest?: string }
  reset?: () => void
}) {
  useEffect(() => {
    // Enhanced error logging for debugging
    logger.error('Global error occurred:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      digest: error.digest,
      // Additional context for crypto-related errors
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : 'N/A',
      location: typeof window !== 'undefined' ? window.location.href : 'N/A',
    })

    // Check if this is a crypto-related error and provide specific guidance
    if (error.message?.includes('randomUUID') || error.message?.includes('crypto')) {
      logger.warn('Crypto API error detected. This may be due to insecure context (HTTP instead of HTTPS)')
    }

    Sentry.captureException(error)
  }, [error])

  return (
    <html lang='en'>
      <body>
        <div style={{ 
          padding: '2rem', 
          textAlign: 'center', 
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: '#1a1a1a',
          color: '#white'
        }}>
          <h1 style={{ color: '#ef4444', marginBottom: '1rem' }}>
            Application Error
          </h1>
          <p style={{ marginBottom: '1rem', color: '#a3a3a3' }}>
            A client-side exception has occurred. This error has been logged for investigation.
          </p>
          {error.message?.includes('randomUUID') || error.message?.includes('crypto') ? (
            <div style={{ 
              backgroundColor: '#374151', 
              padding: '1rem', 
              borderRadius: '0.5rem', 
              marginBottom: '1rem',
              color: '#fbbf24'
            }}>
              <p><strong>Tip:</strong> This error may be resolved by:</p>
              <ul style={{ textAlign: 'left', margin: '0.5rem 0' }}>
                <li>Accessing the application via HTTPS</li>
                <li>Using localhost instead of other local IP addresses</li>
                <li>Checking your browser security settings</li>
              </ul>
            </div>
          ) : null}
          {reset && (
            <button
              onClick={reset}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Try Again
            </button>
          )}
          <details style={{ marginTop: '2rem', textAlign: 'left', maxWidth: '600px', margin: '2rem auto 0' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '1rem' }}>Error Details</summary>
            <pre style={{ 
              backgroundColor: '#374151', 
              padding: '1rem', 
              borderRadius: '0.25rem',
              overflow: 'auto',
              fontSize: '0.8rem',
              color: '#d1d5db'
            }}>
              {error.name}: {error.message}
              {error.stack && `\n\nStack Trace:\n${error.stack}`}
            </pre>
          </details>
        </div>
      </body>
    </html>
  )
}
