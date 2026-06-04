import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { telemetryContract } from '@/lib/api/contracts/telemetry'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/feature-flags'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('TelemetryAPI')

const DEFAULT_TIMEOUT = 5000

/**
 * Safely converts a value to string, handling undefined and null values
 */
function safeStringValue(value: unknown): string {
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
  data: Record<string, unknown>
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
async function forwardToCollector(data: Record<string, unknown>): Promise<boolean> {
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
export const POST = withRouteHandler(async (req: NextRequest) => {
  const rateLimited = await enforceIpRateLimit('telemetry', req, {
    maxTokens: 60,
    refillRate: 30,
    refillIntervalMs: 60_000,
  })
  if (rateLimited) return rateLimited

  try {
    const parsed = await parseRequest(telemetryContract, req, {})
    if (!parsed.success) return parsed.response

    const forwarded = await forwardToCollector(parsed.data.body)

    return NextResponse.json({
      success: true,
      forwarded,
    })
  } catch (error) {
    logger.error('Error processing telemetry event', error)
    return NextResponse.json({ error: 'Failed to process telemetry event' }, { status: 500 })
  }
})
