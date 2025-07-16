import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('TelemetryAPI')

const ALLOWED_CATEGORIES = [
  'page_view',
  'feature_usage',
  'performance',
  'error',
  'workflow',
  'consent',
]

const DEFAULT_TIMEOUT = 5000 // 5 seconds timeout

/**
 * Validates telemetry data to ensure it doesn't contain sensitive information
 */
function validateTelemetryData(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false
  }

  if (!data.category || !data.action) {
    return false
  }

  if (!ALLOWED_CATEGORIES.includes(data.category)) {
    return false
  }

  const jsonStr = JSON.stringify(data).toLowerCase()
  const sensitivePatterns = [/password/, /token/, /secret/, /key/, /auth/, /credential/, /private/]

  return !sensitivePatterns.some((pattern) => pattern.test(jsonStr))
}

/**
 * Safely converts a value to string, handling undefined and null values
 */
function safeStringValue(value: any): string {
  if (value === undefined || value === null) {
    return ''
  }

  try {
    return String(value)
  } catch (_e) {
    return ''
  }
}

/**
 * Creates a safe attribute object for OpenTelemetry
 */
function createSafeAttributes(
  data: Record<string, any>
): Array<{ key: string; value: { stringValue: string } }> {
  if (!data || typeof data !== 'object') {
    return []
  }

  const attributes: Array<{ key: string; value: { stringValue: string } }> = []

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key) {
      attributes.push({
        key,
        value: { stringValue: safeStringValue(value) },
      })
    }
  })

  return attributes
}

/**
 * Forwards telemetry data to OpenTelemetry collector
 */
async function forwardToCollector(data: any): Promise<boolean> {
  if (!data || typeof data !== 'object') {
    logger.error('Invalid telemetry data format')
    return false
  }

  const endpoint = env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.ai/v1/traces'
  const timeout = DEFAULT_TIMEOUT

  try {
    const timestamp = Date.now() * 1000000

    const safeAttrs = createSafeAttributes(data)

    const serviceAttrs = [
      { key: 'service.name', value: { stringValue: 'sim-studio' } },
      {
        key: 'service.version',
        value: { stringValue: '0.1.0' },
      },
      {
        key: 'deployment.environment',
        value: { stringValue: isProd ? 'production' : 'development' },
      },
    ]

    const spanName =
      data.category && data.action ? `${data.category}.${data.action}` : 'telemetry.event'

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: serviceAttrs,
          },
          instrumentationLibrarySpans: [
            {
              spans: [
                {
                  name: spanName,
                  kind: 1,
                  startTimeUnixNano: timestamp,
                  endTimeUnixNano: timestamp + 1000000,
                  attributes: safeAttrs,
                },
              ],
            },
          ],
        },
      ],
    }

    // Create explicit AbortController for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }

      const response = await fetch(endpoint, options)
      clearTimeout(timeoutId)

      if (!response.ok) {
        logger.error('Telemetry collector returned error', {
          status: response.status,
          statusText: response.statusText,
        })
        return false
      }

      return true
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Telemetry request timed out', { endpoint })
      } else {
        logger.error('Failed to send telemetry to collector', fetchError)
      }
      return false
    }
  } catch (error) {
    logger.error('Error preparing telemetry payload', error)
    return false
  }
}

/**
 * Endpoint that receives telemetry events and forwards them to OpenTelemetry collector
 */
export async function POST(req: NextRequest) {
  try {
    let eventData
    try {
      eventData = await req.json()
    } catch (_parseError) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    if (!validateTelemetryData(eventData)) {
      return NextResponse.json(
        { error: 'Invalid telemetry data format or contains sensitive information' },
        { status: 400 }
      )
    }

    const forwarded = await forwardToCollector(eventData)

    return NextResponse.json({
      success: true,
      forwarded,
    })
  } catch (error) {
    logger.error('Error processing telemetry event', error)
    return NextResponse.json({ error: 'Failed to process telemetry event' }, { status: 500 })
  }
}
