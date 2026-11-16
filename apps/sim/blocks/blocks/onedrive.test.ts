import { describe, expect, it } from 'vitest'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import type { BlockToolParamsContext } from '@/blocks/types'

/** What the tool receives: the mapper's result spread over its own input, as both callers merge it. */
const forwarded = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
  ...inputs,
  ...(OneDriveBlock.tools.config?.params?.(inputs, context) ?? {}),
})

describe('OneDriveBlock tool-call params', () => {
  it('keeps the model-supplied file and destination ids on a move', () => {
    const result = forwarded(
      { oauthCredential: 'cred', fileId: 'item-1', destinationFolderId: 'folder-2' },
      { operation: 'move' }
    )

    expect(result.fileId).toBe('item-1')
    expect(result.destinationFolderId).toBe('folder-2')
  })

  it('resolves the per-operation picker stored on the tool row', () => {
    const result = forwarded(
      { oauthCredential: 'cred', listFolderId: ' folder-9 ' },
      { operation: 'list' }
    )

    expect(result.folderId).toBe('folder-9')
  })
})
