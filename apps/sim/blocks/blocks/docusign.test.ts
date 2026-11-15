import { describe, expect, it } from 'vitest'
import { DocuSignBlock } from '@/blocks/blocks/docusign'

function runCanvas(params: Record<string, unknown>) {
  const mapper = DocuSignBlock.tools.config?.params
  if (!mapper) throw new Error('DocuSign block has no params mapper')
  return { ...params, ...mapper(params) }
}

describe('DocuSign List Envelopes status filter', () => {
  it('does not filter by the stored Send Envelope status when the list filter is All', () => {
    const merged = runCanvas({
      operation: 'list_envelopes',
      envelopeStatus: 'sent',
      listEnvelopeStatus: '',
    })

    expect(merged.envelopeStatus).toBeUndefined()
  })

  it('sends the chosen list filter', () => {
    const merged = runCanvas({
      operation: 'list_envelopes',
      envelopeStatus: 'sent',
      listEnvelopeStatus: 'completed',
    })

    expect(merged.envelopeStatus).toBe('completed')
  })
})
