import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { IncidentIOWidgetResponse, StatusResponse, StatusType } from '@/app/api/status/types'

const logger = createLogger('StatusAPI')

let cachedResponse: { data: StatusResponse; timestamp: number } | null = null
const CACHE_TTL = 2 * 60 * 1000

function determineStatus(data: IncidentIOWidgetResponse): {
  status: StatusType
  message: string
} {
  if (data.ongoing_incidents && data.ongoing_incidents.length > 0) {
    const worstImpact = data.ongoing_incidents[0].current_worst_impact

    if (worstImpact === 'full_outage') {
      return { status: 'outage', message: 'Service Disruption' }
    }
    if (worstImpact === 'partial_outage') {
      return { status: 'degraded', message: 'Experiencing Issues' }
    }
    return { status: 'degraded', message: 'Experiencing Issues' }
  }

  if (data.in_progress_maintenances && data.in_progress_maintenances.length > 0) {
    return { status: 'maintenance', message: 'Under Maintenance' }
  }

  return { status: 'operational', message: 'All Systems Operational' }
}

export async function GET() {
  try {
    const now = Date.now()

    if (cachedResponse && now - cachedResponse.timestamp < CACHE_TTL) {
      return NextResponse.json(cachedResponse.data, {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=60',
          'X-Cache': 'HIT',
        },
      })
    }

    const response = await fetch('https://status.sim.ai/api/v1/summary', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`incident.io API returned ${response.status}`)
    }

    const data: IncidentIOWidgetResponse = await response.json()

    const { status, message } = determineStatus(data)

    const statusResponse: StatusResponse = {
      status,
      message,
      url: data.page_url || 'https://status.sim.ai',
      lastUpdated: new Date().toISOString(),
    }

    cachedResponse = {
      data: statusResponse,
      timestamp: now,
    }

    return NextResponse.json(statusResponse, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    logger.error('Error fetching status from incident.io:', error)

    const errorResponse: StatusResponse = {
      status: 'error',
      message: 'Status Unknown',
      url: 'https://status.sim.ai',
      lastUpdated: new Date().toISOString(),
    }

    return NextResponse.json(errorResponse, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=30',
      },
    })
  }
}
