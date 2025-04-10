/**
 * Tests for OpenAI API key rotation endpoint
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

describe('OpenAI API Key Endpoint', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()

    // Set up environment variables for tests
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.simstudio.ai'
    process.env.OPENAI_API_KEY_1 = 'test-openai-key-1'
    process.env.OPENAI_API_KEY_2 = 'test-openai-key-2'

    // Mock Date.getMinutes to make tests deterministic
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0)
  })

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('should return a valid API key for gpt-4o on hosted version', async () => {
    const { POST } = await import('./route')

    const request = new NextRequest('https://www.simstudio.ai/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('apiKey')
    expect(data.apiKey).toBe('test-openai-key-1') // First key since minutes = 0
  })

  it('should return a different key based on rotation', async () => {
    const { POST } = await import('./route')

    // Change mock to return a different minute
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(1)

    const request = new NextRequest('https://www.simstudio.ai/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('apiKey')
    expect(data.apiKey).toBe('test-openai-key-2') // Second key since minutes = 1
  })

  it('should reject requests for models other than gpt-4o', async () => {
    const { POST } = await import('./route')

    const request = new NextRequest('https://www.simstudio.ai/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('only available for gpt-4o models')
  })

  it('should reject requests from non-hosted environments', async () => {
    // Change to non-hosted URL
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    const { POST } = await import('./route')

    const request = new NextRequest('http://localhost:3000/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('only available on the hosted version')
  })

  it('should handle missing model parameter', async () => {
    const { POST } = await import('./route')

    const request = new NextRequest('https://www.simstudio.ai/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Model parameter is required')
  })

  it('should handle missing API keys in environment', async () => {
    // Remove API keys from environment
    delete process.env.OPENAI_API_KEY_1
    delete process.env.OPENAI_API_KEY_2

    const { POST } = await import('./route')

    const request = new NextRequest('https://www.simstudio.ai/api/keys/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('No API keys configured')
  })
})
