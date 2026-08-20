import { createWebhookEndpointTool } from '@/tools/granola/create_webhook_endpoint'
import { deleteWebhookEndpointTool } from '@/tools/granola/delete_webhook_endpoint'
import { getNoteTool } from '@/tools/granola/get_note'
import { getTranscriptTool } from '@/tools/granola/get_transcript'
import { listAuditEventsTool } from '@/tools/granola/list_audit_events'
import { listFoldersTool } from '@/tools/granola/list_folders'
import { listNotesTool } from '@/tools/granola/list_notes'
import { listWebhookEndpointsTool } from '@/tools/granola/list_webhook_endpoints'
import { updateWebhookEndpointTool } from '@/tools/granola/update_webhook_endpoint'

export const granolaListNotesTool = listNotesTool
export const granolaGetNoteTool = getNoteTool
export const granolaGetTranscriptTool = getTranscriptTool
export const granolaListFoldersTool = listFoldersTool
export const granolaListAuditEventsTool = listAuditEventsTool
export const granolaCreateWebhookEndpointTool = createWebhookEndpointTool
export const granolaListWebhookEndpointsTool = listWebhookEndpointsTool
export const granolaUpdateWebhookEndpointTool = updateWebhookEndpointTool
export const granolaDeleteWebhookEndpointTool = deleteWebhookEndpointTool
