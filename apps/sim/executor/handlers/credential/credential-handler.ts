import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray } from 'drizzle-orm'
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
    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for credential resolution')
    }

    const operation = typeof inputs.operation === 'string' ? inputs.operation : 'select'

    if (operation === 'list') {
      return this.listCredentials(ctx.workspaceId, inputs)
    }

    return this.selectCredential(ctx.workspaceId, inputs)
  }

  private async selectCredential(
    workspaceId: string,
    inputs: Record<string, unknown>
  ): Promise<BlockOutput> {
    const credentialId = typeof inputs.credentialId === 'string' ? inputs.credentialId.trim() : ''

    if (!credentialId) {
      throw new Error('No credential selected')
    }

    const record = await db.query.credential.findFirst({
      where: and(
        eq(credential.id, credentialId),
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'oauth')
      ),
      columns: {
        id: true,
        displayName: true,
        providerId: true,
      },
    })

    if (!record) {
      throw new Error(`Credential not found: ${credentialId}`)
    }

    logger.info('Credential block resolved', { credentialId: record.id })

    return {
      credentialId: record.id,
      displayName: record.displayName,
      providerId: record.providerId ?? '',
    }
  }

  private async listCredentials(
    workspaceId: string,
    inputs: Record<string, unknown>
  ): Promise<BlockOutput> {
    const providerFilter = Array.isArray(inputs.providerFilter)
      ? (inputs.providerFilter as string[]).filter(Boolean)
      : []

    const conditions = [eq(credential.workspaceId, workspaceId), eq(credential.type, 'oauth')]

    if (providerFilter.length > 0) {
      conditions.push(inArray(credential.providerId, providerFilter))
    }

    const records = await db.query.credential.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        displayName: true,
        providerId: true,
      },
      orderBy: [asc(credential.displayName)],
    })

    const credentials = records.map((r) => ({
      credentialId: r.id,
      displayName: r.displayName,
      providerId: r.providerId ?? '',
    }))

    logger.info('Credential block listed credentials', {
      count: credentials.length,
      providerFilter: providerFilter.length > 0 ? providerFilter : undefined,
    })

    return {
      credentials,
      count: credentials.length,
    }
  }
}
