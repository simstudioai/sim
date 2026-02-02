import type { IncomingMessage, ServerResponse } from 'http'
import { env } from '@/lib/core/config/env'
import type { IRoomManager } from '@/socket/rooms'

interface Logger {
  info: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

function checkInternalApiKey(req: IncomingMessage): { success: boolean; error?: string } {
  const apiKey = req.headers['x-api-key']
  const expectedApiKey = env.INTERNAL_API_SECRET

  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }

  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }

  if (apiKey !== expectedApiKey) {
    return { success: false, error: 'Invalid API key' }
  }

  return { success: true }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendSuccess(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ success: true }))
}

function sendError(res: ServerResponse, message: string, status = 500): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

/**
 * Creates an HTTP request handler for the socket server
 * @param roomManager - RoomManager instance for managing workflow rooms and state
 * @param logger - Logger instance for logging requests and errors
 * @returns HTTP request handler function
 */
export function createHttpHandler(roomManager: IRoomManager, logger: Logger) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Health check doesn't require auth
    if (req.method === 'GET' && req.url === '/health') {
      try {
        const connections = await roomManager.getTotalActiveConnections()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            connections,
          })
        )
      } catch (error) {
        logger.error('Error in health check:', error)
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', message: 'Health check failed' }))
      }
      return
    }

    // All POST endpoints require internal API key authentication
    if (req.method === 'POST') {
      const authResult = checkInternalApiKey(req)
      if (!authResult.success) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: authResult.error }))
        return
      }

      if (!roomManager.isReady()) {
        sendError(res, 'Room manager unavailable', 503)
        return
      }
    }

    // Handle workflow deletion notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-deleted') {
      try {
        const body = await readRequestBody(req)
        const { workflowId } = JSON.parse(body)
        await roomManager.handleWorkflowDeletion(workflowId)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow deletion notification:', error)
        sendError(res, 'Failed to process deletion notification')
      }
      return
    }

    // Handle workflow update notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-updated') {
      try {
        const body = await readRequestBody(req)
        const { workflowId } = JSON.parse(body)
        await roomManager.handleWorkflowUpdate(workflowId)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow update notification:', error)
        sendError(res, 'Failed to process update notification')
      }
      return
    }

    // Handle workflow revert notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-reverted') {
      try {
        const body = await readRequestBody(req)
        const { workflowId, timestamp } = JSON.parse(body)
        await roomManager.handleWorkflowRevert(workflowId, timestamp)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow revert notification:', error)
        sendError(res, 'Failed to process revert notification')
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
