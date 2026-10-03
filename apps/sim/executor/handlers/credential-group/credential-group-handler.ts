import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import type { BlockHandler } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/** Legacy blocks must be explicitly replaced because organization access has different scope. */
export class CredentialGroupBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CREDENTIAL_GROUP
  }
  async execute(): Promise<BlockOutput> {
    throw new Error(
      'Replace this legacy Connected Accounts block with a Credential block and configure its organization operation. Invitations are managed in organization settings.'
    )
  }
}
