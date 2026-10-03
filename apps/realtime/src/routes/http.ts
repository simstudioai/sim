import type { IncomingMessage, ServerResponse } from 'http'
import { FILE_DOC_EVENTS, type FileDocInvalidated } from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES, roomName, WORKSPACE_LIST_ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { safeCompare } from '@sim/security/compare'
import { env } from '@/env'
import {
  applyMarkdownToLiveFileDoc,
  fileDocAdmissionRoom,
  invalidateLiveFileDocument,
} from '@/handlers/file-doc'
import { type IRoomManager, WorkflowRoomService } from '@/rooms'

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

  const apiKeyStr = Array.isArray(apiKey) ? apiKey[0] : apiKey
  if (!apiKeyStr || !safeCompare(apiKeyStr, expectedApiKey)) {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
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
  const workflowRoomService = new WorkflowRoomService(roomManager)

  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')

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
        if (!isNonEmptyString(workflowId)) return sendError(res, 'Invalid workflowId', 400)
        await workflowRoomService.handleWorkflowDeletion(workflowId)
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
        if (!isNonEmptyString(workflowId)) return sendError(res, 'Invalid workflowId', 400)
        await workflowRoomService.handleWorkflowUpdate(workflowId)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow update notification:', error)
        sendError(res, 'Failed to process update notification')
      }
      return
    }

    // Handle workflow deployment change notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-deployed') {
      try {
        const body = await readRequestBody(req)
        const { workflowId } = JSON.parse(body)
        if (!isNonEmptyString(workflowId)) return sendError(res, 'Invalid workflowId', 400)
        await workflowRoomService.handleWorkflowDeployed(workflowId)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow deployed notification:', error)
        sendError(res, 'Failed to process deployment notification')
      }
      return
    }

    // Handle workflow revert notifications from the main API
    if (req.method === 'POST' && req.url === '/api/workflow-reverted') {
      try {
        const body = await readRequestBody(req)
        const { workflowId, timestamp } = JSON.parse(body)
        if (!isNonEmptyString(workflowId)) return sendError(res, 'Invalid workflowId', 400)
        await workflowRoomService.handleWorkflowRevert(workflowId, timestamp)
        sendSuccess(res)
      } catch (error) {
        logger.error('Error handling workflow revert notification:', error)
        sendError(res, 'Failed to process revert notification')
      }
      return
    }

    // Fan out a workspace list change (files tree, tables list, workflow registry) to everyone in
    // that workspace's live-list room, so their browser refetches. These mutations happen over the
    // HTTP API (not the socket); this is the lossy liveness signal — a missed one only means
    // stale-until-refetch. Endpoint and event names derive from the room type, mirroring the socket
    // handler and the client hook.
    const listRoomType = WORKSPACE_LIST_ROOM_TYPES.find(
      (type) => req.url === `/api/${type}-changed`
    )
    if (req.method === 'POST' && listRoomType) {
      try {
        const body = await readRequestBody(req)
        const { workspaceId } = JSON.parse(body)
        if (!isNonEmptyString(workspaceId)) return sendError(res, 'Invalid workspaceId', 400)
        roomManager.emitToRoom({ type: listRoomType, id: workspaceId }, `${listRoomType}-changed`, {
          workspaceId,
          timestamp: Date.now(),
        })
        sendSuccess(res)
      } catch (error) {
        logger.error(`Error handling ${listRoomType} changed notification:`, error)
        sendError(res, 'Failed to process list change notification')
      }
      return
    }

    // Merge a durable file write into a file's LIVE collaborative document so open editors reconcile to
    // it (Stage C) — this is the stream-end/durable reconcile, not token-by-token streaming (that is now
    // applied client-side by the open editor). Returns `{ applied }`: when false, no seeded live room
    // exists and the caller writes the file directly instead. Live user edits are preserved — the app
    // builds a minimal CRDT diff.
    if (req.method === 'POST' && req.url === '/api/file-doc/apply-edit') {
      try {
        const body = await readRequestBody(req)
        const { fileId, markdown, version } = JSON.parse(body)
        if (!isNonEmptyString(fileId) || typeof markdown !== 'string') {
          return sendError(res, 'Invalid fileId or markdown', 400)
        }
        // `version` (the durable updatedAt this markdown was written with) records that the live doc now
        // incorporates that durable version, so the persist If-Match guard won't flag it as a conflict.
        const result = await applyMarkdownToLiveFileDoc(fileId, markdown, {
          version: typeof version === 'number' ? version : undefined,
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ applied: result === 'applied', status: result }))
      } catch (error) {
        logger.error('Error applying copilot edit to live file-doc:', error)
        sendError(res, 'Failed to apply edit to live document')
      }
      return
    }

    if (req.method === 'POST' && req.url === '/api/file-doc/invalidate') {
      try {
        const body = await readRequestBody(req)
        const { fileId, version } = JSON.parse(body)
        if (!isNonEmptyString(fileId)) return sendError(res, 'Invalid fileId', 400)
        if (!Number.isSafeInteger(version) || version <= 0) {
          return sendError(res, 'Invalid version', 400)
        }
        const room = { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: fileId } as const
        const result = await invalidateLiveFileDocument(fileId, version)
        const payload: FileDocInvalidated = {
          fileId,
          version,
          ...(result.status === 'applied' && result.docId ? { docId: result.docId } : {}),
          message: 'This file changed outside the editor. Reload to continue editing.',
        }
        if (result.status === 'applied')
          roomManager.io
            .to([roomName(room), fileDocAdmissionRoom(fileId)])
            .emit(FILE_DOC_EVENTS.INVALIDATED, payload)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: result.status }))
      } catch (error) {
        logger.error('Error invalidating live file-doc:', error)
        sendError(res, 'Failed to invalidate live document')
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
