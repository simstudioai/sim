import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('CredentialBlockHandler')

export class CredentialBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CREDENTIAL
  }

  async execute(
    ctx: ExecutionContext,
    _block: SerializedBlock,
    inputs: Record<string, unknown>
  ): Promise<BlockOutput> {
    const credentialId = typeof inputs.credentialId === 'string' ? inputs.credentialId.trim() : ''

    if (!credentialId) {
      throw new Error('No credential selected')
    }

    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for credential resolution')
    }

    const record = await db.query.credential.findFirst({
      where: and(eq(credential.id, credentialId), eq(credential.workspaceId, ctx.workspaceId)),
      columns: {
        id: true,
        displayName: true,
        type: true,
        providerId: true,
      },
    })

    if (!record) {
      throw new Error(`Credential not found: ${credentialId}`)
    }

    logger.info('Credential block resolved', { credentialId: record.id, type: record.type })

    return {
      credentialId: record.id,
      displayName: record.displayName,
      type: record.type,
      providerId: record.providerId ?? '',
    }
  }
}
