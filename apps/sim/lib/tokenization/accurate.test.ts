import { getEncoding } from 'js-tiktoken'
import { describe, expect, it } from 'vitest'
import { getAccurateTokenCount } from '@/lib/tokenization/accurate'

/** Non-Latin text tokenizes very differently under `o200k_base` and `cl100k_base`. */
const SAMPLE = 'नमस्ते दुनिया, यह एक परीक्षण वाक्य है। 你好世界，这是一个测试句子。'

describe('getAccurateTokenCount encoding resolution', () => {
  const o200kCount = getEncoding('o200k_base').encode(SAMPLE).length

  it('uses o200k_base for OpenAI model ids newer than the tokenizer table', () => {
    expect(o200kCount).not.toBe(getEncoding('cl100k_base').encode(SAMPLE).length)
    expect(getAccurateTokenCount(SAMPLE, 'gpt-5.6-sol')).toBe(o200kCount)
    expect(getAccurateTokenCount(SAMPLE, 'o3-pro')).toBe(o200kCount)
  })

  it('resolves provider-prefixed OpenAI model ids by their base model', () => {
    expect(getAccurateTokenCount(SAMPLE, 'azure/gpt-4o')).toBe(o200kCount)
  })
})
