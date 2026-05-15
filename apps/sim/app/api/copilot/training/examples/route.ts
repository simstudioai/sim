import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotTrainingExampleContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotTrainingExamplesAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) {
    return createUnauthorizedResponse()
  }

  const baseUrl = env.AGENT_INDEXER_URL
  if (!baseUrl) {
    logger.error('Missing AGENT_INDEXER_URL environment variable')
    return NextResponse.json({ error: 'Missing AGENT_INDEXER_URL env' }, { status: 500 })
  }

  const apiKey = env.AGENT_INDEXER_API_KEY
  if (!apiKey) {
    logger.error('Missing AGENT_INDEXER_API_KEY environment variable')
    return NextResponse.json({ error: 'Missing AGENT_INDEXER_API_KEY env' }, { status: 500 })
  }

  try {
    const parsed = await parseRequest(
      copilotTrainingExampleContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn('Invalid training example format', { errors: error.issues })
          return validationErrorResponse(error, 'Invalid training example format')
        },
      }
    )
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Sending workflow example to agent indexer', {
      hasJsonField: typeof validatedData.json === 'string',
      title: validatedData.title,
    })

    const upstream = await fetch(`${baseUrl}/examples/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(validatedData),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Agent indexer rejected the example', {
        status: upstream.status,
        error: errorText,
      })
      return NextResponse.json({ error: errorText }, { status: upstream.status })
    }

    const data = await upstream.json()
    logger.info('Successfully sent workflow example to agent indexer')

    return NextResponse.json(data, {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const errorMessage = getErrorMessage(err, 'Failed to add example')
    logger.error('Failed to send workflow example', { error: err })
    return NextResponse.json({ error: errorMessage }, { status: 502 })
  }
})
