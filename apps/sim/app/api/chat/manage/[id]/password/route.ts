import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getChatPasswordContract } from '@/lib/api/contracts/chats'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { decryptSecret } from '@/lib/core/security/encryption'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkChatAccess } from '@/app/api/chat/utils'
import { createErrorResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ChatPasswordAPI')
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const

/**
 * GET endpoint that reveals a chat deployment's current password.
 * Restricted to workspace admins (checkChatAccess requires admin permission
 * on the workflow's workspace); each reveal is recorded in the audit log.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const parsed = await parseRequest(getChatPasswordContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: chatId } = parsed.data.params

      const {
        hasAccess,
        chat: chatRecord,
        workspaceId: chatWorkspaceId,
      } = await checkChatAccess(chatId, session.user.id)

      if (!hasAccess || !chatRecord) {
        return createErrorResponse('Chat not found or access denied', 404)
      }

      if (chatRecord.authType !== 'password' || !chatRecord.password) {
        return createErrorResponse('This chat does not have a password set', 404)
      }

      const { decrypted } = await decryptSecret(chatRecord.password)

      recordAudit({
        workspaceId: chatWorkspaceId || null,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.CHAT_PASSWORD_VIEWED,
        resourceType: AuditResourceType.CHAT,
        resourceId: chatId,
        resourceName: chatRecord.title,
        description: `Viewed the password for chat deployment "${chatRecord.title}"`,
        metadata: {
          identifier: chatRecord.identifier,
          workflowId: chatRecord.workflowId,
        },
        request,
      })

      return NextResponse.json({ password: decrypted }, { headers: PRIVATE_NO_STORE })
    } catch (error) {
      logger.error('Error revealing chat password:', error)
      /**
       * Deliberately opaque: the only errors that reach here come from
       * decryption, whose messages describe the stored ciphertext's shape.
       * The logged error carries the detail for operators.
       */
      return createErrorResponse('Failed to reveal chat password', 500)
    }
  }
)
