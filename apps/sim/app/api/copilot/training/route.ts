import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotTrainingDataContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotTrainingAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) {
    return createUnauthorizedResponse()
  }

  try {
    const baseUrl = env.AGENT_INDEXER_URL
    if (!baseUrl) {
      logger.error('Missing AGENT_INDEXER_URL environment variable')
      return NextResponse.json({ error: 'Agent indexer not configured' }, { status: 500 })
    }

    const apiKey = env.AGENT_INDEXER_API_KEY
    if (!apiKey) {
      logger.error('Missing AGENT_INDEXER_API_KEY environment variable')
      return NextResponse.json(
        { error: 'Agent indexer authentication not configured' },
        { status: 500 }
      )
    }

    const parsed = await parseRequest(
      copilotTrainingDataContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn('Invalid training data format', { errors: error.issues })
          return validationErrorResponse(error, 'Invalid training data format')
        },
      }
    )
    if (!parsed.success) return parsed.response
    const { title, prompt, input, output, operations } = parsed.data.body

    logger.info('Sending training data to agent indexer', {
      title,
      operationsCount: operations.length,
    })

    const upstreamUrl = `${baseUrl}/operations/add`
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title,
        prompt,
        input,
        output,
        operations: { operations },
      }),
    })

    const responseData = await upstreamResponse.json()

    if (!upstreamResponse.ok) {
      logger.error('Agent indexer rejected the data', {
        status: upstreamResponse.status,
        response: responseData,
      })
      return NextResponse.json(responseData, { status: upstreamResponse.status })
    }

    logger.info('Successfully sent training data to agent indexer', {
      title,
      response: responseData,
    })

    return NextResponse.json(responseData)
  } catch (error) {
    logger.error('Failed to send training data to agent indexer', { error })
    return NextResponse.json(
      {
        error: getErrorMessage(error, 'Failed to send training data'),
      },
      { status: 502 }
    )
  }
})
