import {
  tokenizationAccurateMock,
  tokenizationAccurateMockFns,
} from '@sim/testing/mocks/tokenization-accurate.mock'
import { describe, expect, it, vi } from 'vitest'
import { getConversationTokenCount } from '@/lib/memory/context-tokens'
import { getAccurateTokenCount } from '@/lib/tokenization/accurate'

vi.mock('@/lib/tokenization/accurate', () => tokenizationAccurateMock)

tokenizationAccurateMockFns.mockGetAccurateTokenCount.mockReturnValue(7)

describe('bounded Agent context token estimation', () => {
  it('uses model tokenization for short ordinary context', () => {
    expect(getConversationTokenCount('Review the previous confirmed tool result.', 'model')).toBe(7)
    expect(getAccurateTokenCount).toHaveBeenCalledOnce()
  })

  it.each(['x'.repeat(140_000), 'ab'.repeat(70_000), '🌍'.repeat(70_000), 'x'.repeat(128)])(
    'bypasses expensive tokenizer work for large or repetitive context',
    (text) => {
      expect(getConversationTokenCount(text, 'model')).toBe(Buffer.byteLength(text, 'utf8'))
      expect(getAccurateTokenCount).not.toHaveBeenCalled()
    }
  )
})
