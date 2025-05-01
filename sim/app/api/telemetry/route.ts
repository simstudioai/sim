import { NextRequest, NextResponse } from 'next/server'
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

/**
 * Validates telemetry data to ensure it doesn't contain sensitive information
 */
function validateTelemetryData(data: any): boolean {
  if (!data.category || !data.action) {
    return false
  }
  
  if (!ALLOWED_CATEGORIES.includes(data.category)) {
    return false
  }
  
  const jsonStr = JSON.stringify(data).toLowerCase()
  const sensitivePatterns = [
    /password/,
    /token/,
    /secret/,
    /key/,
    /auth/,
    /credential/,
    /private/,
  ]
  
  return !sensitivePatterns.some(pattern => pattern.test(jsonStr))
}

/**
 * Forwards telemetry data to OpenTelemetry collector
 */
async function forwardToCollector(data: any): Promise<boolean> {
  try {
    let telemetryConfig
    try {
      telemetryConfig = require('@/telemetry.config.js')
    } catch (e) {
      telemetryConfig = {
        endpoint: process.env.TELEMETRY_ENDPOINT || 'https://telemetry.simstudio.dev/v1/traces',
      }
    }
    
    const timestamp = new Date().getTime() * 1000 // Convert to nanoseconds
    const span = {
      name: `${data.category}.${data.action}`,
      kind: 1, 
      startTimeUnixNano: timestamp,
      endTimeUnixNano: timestamp + 1000000, // 1ms duration
      attributes: Object.entries(data).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) },
      })),
    }
    
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: data.service || 'sim-studio' } },
              { key: 'service.version', value: { stringValue: data.version || '0.1.0' } },
              { key: 'deployment.environment', value: { stringValue: process.env.NODE_ENV || 'production' } },
            ],
          },
          instrumentationLibrarySpans: [
            {
              spans: [span],
            },
          ],
        },
      ],
    }
    
    const response = await fetch(telemetryConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    
    return response.ok
  } catch (error) {
    logger.error('Failed to forward telemetry to collector', error)
    return false
  }
}

/**
 * Endpoint that receives telemetry events and forwards them to OpenTelemetry collector
 */
export async function POST(req: NextRequest) {
  try {
    const eventData = await req.json()
    
    if (!validateTelemetryData(eventData)) {
      return NextResponse.json(
        { error: 'Invalid telemetry data' },
        { status: 400 }
      )
    }
    
    const forwarded = await forwardToCollector(eventData)
    
    return NextResponse.json({ 
      success: true,
      forwarded
    })
  } catch (error) {
    logger.error('Error processing telemetry event', error)
    return NextResponse.json(
      { error: 'Failed to process telemetry event' },
      { status: 500 }
    )
  }
} 