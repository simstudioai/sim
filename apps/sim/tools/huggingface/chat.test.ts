import { describe, expect, it } from 'vitest'
import { chatTool } from '@/tools/huggingface/chat'

function chatUrl(provider: string, model = 'org/model-name'): string {
  const url = chatTool.request.url
  if (typeof url !== 'function') throw new Error('Hugging Face chat URL must be built per request')
  return url({ apiKey: 'hf_test', provider, model, content: 'hi' })
}

describe('Hugging Face chat routing', () => {
  it('sends Cohere to its compatibility chat route', () => {
    expect(chatUrl('cohere')).toBe(
      'https://router.huggingface.co/cohere/compatibility/v1/chat/completions'
    )
  })

  it('sends Fireworks to the fireworks-ai router prefix and inference route', () => {
    expect(chatUrl('fireworks')).toBe(
      'https://router.huggingface.co/fireworks-ai/inference/v1/chat/completions'
    )
  })

  it('sends HF Inference to the model chat route', () => {
    expect(chatUrl('hf-inference', 'meta-llama/Llama-3.1-8B-Instruct')).toBe(
      'https://router.huggingface.co/hf-inference/models/meta-llama/Llama-3.1-8B-Instruct/v1/chat/completions'
    )
  })

  it('rejects an HF Inference model with a dot segment', () => {
    expect(() => chatUrl('hf-inference', 'org/../whoami')).toThrow(/path traversal/)
  })
})
