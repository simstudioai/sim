import { describe, expect, it } from 'vitest'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import type { BlockToolParamsContext } from '@/blocks/types'

/** What the tool receives: the mapper's result spread over its own input, as both callers merge it. */
const forwarded = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
  ...inputs,
  ...(MicrosoftTeamsBlock.tools.config?.params?.(inputs, context) ?? {}),
})

describe('MicrosoftTeamsBlock tool-call params', () => {
  it('sends a single attached file as the file list the tool expects', () => {
    const file = {
      name: 'report.pdf',
      key: 'workspace/report.pdf',
      size: 10,
      type: 'application/pdf',
    }
    const result = forwarded(
      { oauthCredential: 'cred', chatId: 'chat-1', content: 'See attached', files: file },
      { operation: 'write_chat' }
    )

    expect(result.files).toEqual([file])
  })
})
