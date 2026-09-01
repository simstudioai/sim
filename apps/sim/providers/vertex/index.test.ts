/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

const { mockGoogleGenAI, genAIArgs, mockExecuteGeminiRequest } = vi.hoisted(() => {
  const genAIArgs: Array<Record<string, unknown>> = []
  class MockGoogleGenAI {
    constructor(opts: Record<string, unknown>) {
      genAIArgs.push(opts)
    }
  }
  return {
    mockGoogleGenAI: MockGoogleGenAI,
    genAIArgs,
    mockExecuteGeminiRequest: vi.fn(),
  }
})

vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }))
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials() {}
  },
}))
vi.mock('@/providers/gemini/core', () => ({ executeGeminiRequest: mockExecuteGeminiRequest }))
vi.mock('@/providers/models', () => ({
  getProviderModels: () => ['vertex/gemini-2.0-flash'],
  getProviderDefaultModel: () => 'vertex/gemini-2.0-flash',
}))
vi.mock('@/lib/core/config/env', () => ({ env: {} }))

import { vertexProvider } from '@/providers/vertex'

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'vertex/gemini-2.0-flash',
    apiKey: 'ya29.canary-token',
    vertexProject: 'pentest-proj',
    messages: [],
    ...overrides,
  } as ProviderRequest
}

describe('vertexProvider location and project validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    genAIArgs.length = 0
    mockExecuteGeminiRequest.mockResolvedValue({ content: 'ok' })
  })

  it('rejects a location that terminates the URL authority', async () => {
    await expect(
      vertexProvider.executeRequest(request({ vertexLocation: 'attacker.example.com/x' }))
    ).rejects.toThrow(/Invalid Vertex AI location/)

    expect(genAIArgs).toHaveLength(0)
    expect(mockExecuteGeminiRequest).not.toHaveBeenCalled()
  })

  it.each(['us-central1:8080', 'user@attacker.tld', 'us-central1 attacker.tld', '../us-central1'])(
    'rejects the malformed location %j without constructing a client',
    async (vertexLocation) => {
      await expect(vertexProvider.executeRequest(request({ vertexLocation }))).rejects.toThrow(
        /Invalid Vertex AI location/
      )
      expect(genAIArgs).toHaveLength(0)
    }
  )

  it('rejects a project that injects extra URL path segments', async () => {
    await expect(
      vertexProvider.executeRequest(
        request({ vertexProject: 'proj/../../attacker', vertexLocation: 'us-central1' })
      )
    ).rejects.toThrow(/Invalid Vertex AI project/)

    expect(genAIArgs).toHaveLength(0)
  })

  it('passes a valid location and project through to the SDK', async () => {
    await vertexProvider.executeRequest(request({ vertexLocation: 'europe-west4' }))

    expect(genAIArgs).toHaveLength(1)
    expect(genAIArgs[0]).toMatchObject({
      vertexai: true,
      project: 'pentest-proj',
      location: 'europe-west4',
    })
    expect(mockExecuteGeminiRequest).toHaveBeenCalledTimes(1)
  })

  it('normalizes a mixed-case location rather than rejecting it', async () => {
    await vertexProvider.executeRequest(request({ vertexLocation: 'US-Central1' }))

    expect(genAIArgs[0]).toMatchObject({ location: 'us-central1' })
  })

  it('defaults to us-central1 when no location is supplied', async () => {
    await vertexProvider.executeRequest(request())

    expect(genAIArgs[0]).toMatchObject({ location: 'us-central1' })
  })
})
