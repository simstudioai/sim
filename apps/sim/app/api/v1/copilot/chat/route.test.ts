/**
 * Tests for the deprecated v1 copilot chat API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/v1/copilot/chat/route'

const URL = 'http://localhost:3000/api/v1/copilot/chat'

describe('Deprecated v1 copilot chat route', () => {
  it('POST returns 410 with a success:false error body', async () => {
    const request = new NextRequest(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk-test' },
      body: JSON.stringify({ message: 'hello' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(410)

    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('deprecated')
  })
})
