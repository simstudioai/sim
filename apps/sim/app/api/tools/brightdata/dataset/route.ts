import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'

const logger = createLogger('BrightDataDatasetAPI')

export const maxDuration = 600

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const datasetId = typeof body?.datasetId === 'string' ? body.datasetId : undefined
    const apiToken = typeof body?.apiToken === 'string' ? body.apiToken : undefined

    if (!datasetId || !apiToken) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const params: Record<string, unknown> = { ...body }
    params.datasetId = undefined
    params.apiToken = undefined

    logger.info(`[${requestId}] Triggering dataset`, { datasetId })

    const triggerResponse = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(
        datasetId
      )}&include_errors=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([params]),
      }
    )

    const triggerText = await triggerResponse.text()
    let triggerPayload: unknown = triggerText

    try {
      triggerPayload = JSON.parse(triggerText)
    } catch {
      triggerPayload = triggerText
    }

    if (!triggerResponse.ok) {
      const errorMessage =
        typeof triggerPayload === 'object' && triggerPayload !== null && 'error' in triggerPayload
          ? String((triggerPayload as { error?: unknown }).error)
          : triggerResponse.statusText

      logger.error(`[${requestId}] Dataset trigger failed`, {
        datasetId,
        status: triggerResponse.status,
        error: errorMessage,
      })

      return NextResponse.json(
        { error: errorMessage || 'Dataset trigger failed' },
        { status: triggerResponse.status }
      )
    }

    const snapshotId =
      typeof triggerPayload === 'object' &&
      triggerPayload !== null &&
      'snapshot_id' in triggerPayload
        ? String((triggerPayload as { snapshot_id?: unknown }).snapshot_id ?? '')
        : ''

    if (!snapshotId) {
      logger.error(`[${requestId}] Dataset trigger missing snapshot ID`, { datasetId })
      return NextResponse.json({ error: 'No snapshot ID returned from request' }, { status: 500 })
    }

    logger.info(`[${requestId}] Dataset triggered`, { datasetId, snapshotId })

    const maxAttempts = 600
    let attempts = 0

    while (attempts < maxAttempts) {
      const snapshotResponse = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      const snapshotText = await snapshotResponse.text()
      let snapshotPayload: unknown = snapshotText

      try {
        snapshotPayload = JSON.parse(snapshotText)
      } catch {
        snapshotPayload = snapshotText
      }

      if (!snapshotResponse.ok) {
        if (snapshotResponse.status === 400) {
          const errorMessage =
            typeof snapshotPayload === 'object' &&
            snapshotPayload !== null &&
            'error' in snapshotPayload
              ? String((snapshotPayload as { error?: unknown }).error)
              : snapshotResponse.statusText

          logger.error(`[${requestId}] Dataset snapshot fetch failed`, {
            datasetId,
            snapshotId,
            status: snapshotResponse.status,
            error: errorMessage,
          })

          return NextResponse.json(
            { error: errorMessage || 'Dataset snapshot fetch failed' },
            { status: snapshotResponse.status }
          )
        }

        attempts += 1
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }

      const status =
        typeof snapshotPayload === 'object' &&
        snapshotPayload !== null &&
        'status' in snapshotPayload
          ? String((snapshotPayload as { status?: unknown }).status ?? '')
          : ''

      if (['running', 'building', 'starting'].includes(status)) {
        attempts += 1
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }

      const snapshotAt =
        typeof snapshotPayload === 'object' &&
        snapshotPayload !== null &&
        'snapshot_at' in snapshotPayload
          ? String((snapshotPayload as { snapshot_at?: unknown }).snapshot_at ?? '')
          : undefined

      logger.info(`[${requestId}] Dataset snapshot received`, { datasetId, snapshotId })

      return NextResponse.json({
        data: snapshotPayload,
        snapshot_at: snapshotAt || undefined,
      })
    }

    logger.error(`[${requestId}] Dataset snapshot timed out`, { datasetId, snapshotId })
    return NextResponse.json({ error: 'Timeout waiting for dataset snapshot' }, { status: 504 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dataset fetch failed'
    logger.error(`[${requestId}] Dataset fetch failed`, { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
