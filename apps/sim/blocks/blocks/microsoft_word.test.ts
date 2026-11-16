import { describe, expect, it } from 'vitest'
import { MicrosoftWordBlock } from '@/blocks/blocks/microsoft_word'
import type { BlockToolParamsContext } from '@/blocks/types'

/** What the tool receives: the mapper's result spread over its own input, as both callers merge it. */
const forwarded = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
  ...inputs,
  ...(MicrosoftWordBlock.tools.config?.params?.(inputs, context) ?? {}),
})

describe('MicrosoftWordBlock tool-call params', () => {
  it('appends the content the model passes under the tool param name', () => {
    const result = forwarded(
      { oauthCredential: 'cred', documentId: 'doc-1', content: 'More text' },
      { operation: 'append' }
    )

    expect(result.content).toBe('More text')
  })

  it('keeps the model-supplied folder and coerces matchCase when creating from a template', () => {
    const result = forwarded(
      {
        oauthCredential: 'cred',
        templateDocumentId: 'tpl-1',
        name: 'Offer',
        folderId: 'folder-1',
        matchCase: 'true',
      },
      { operation: 'create_from_template' }
    )

    expect(result.folderId).toBe('folder-1')
    expect(result.matchCase).toBe(true)
  })
})
