import { NextRequest } from 'next/server'
/**
 * Tests for subdomain validation API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Subdomain Validation API Route', () => {
  // Mock database responses
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()

  // Mock success and error responses
  const mockCreateSuccessResponse = vi.fn()
  const mockCreateErrorResponse = vi.fn()
  const mockNextResponseJson = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    // Set up database query chain
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })

    // Mock the database
    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    // Mock the schema
    vi.doMock('@/db/schema', () => ({
      chat: {
        subdomain: 'subdomain',
      },
    }))

    // Mock the logger
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    // Mock the response utilities
    vi.doMock('@/app/api/workflows/utils', () => ({
      createSuccessResponse: mockCreateSuccessResponse.mockImplementation((data) => {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      createErrorResponse: mockCreateErrorResponse.mockImplementation((message, status = 500) => {
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }))

    // Mock the NextResponse json method
    mockNextResponseJson.mockImplementation((data, options) => {
      return new Response(JSON.stringify(data), {
        status: options?.status || 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    vi.doMock('next/server', () => ({
      NextRequest: vi.fn(),
      NextResponse: {
        json: mockNextResponseJson,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when user is not authenticated', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(null),
    }))

    const req = new NextRequest('http://localhost:3000/api/chat/subdomains/validate?subdomain=test')

    const { GET } = await import('./route')

    const response = await GET(req)

    expect(response.status).toBe(401)
    expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
  })

  it('should return 400 when subdomain parameter is missing', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    const req = new NextRequest('http://localhost:3000/api/chat/subdomains/validate')

    const { GET } = await import('./route')

    const response = await GET(req)

    expect(response.status).toBe(400)
    expect(mockCreateErrorResponse).toHaveBeenCalledWith('Missing subdomain parameter', 400)
  })

  it('should return 400 when subdomain format is invalid', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    const req = new NextRequest(
      'http://localhost:3000/api/chat/subdomains/validate?subdomain=Invalid_Subdomain!'
    )

    const { GET } = await import('./route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('available', false)
    expect(data).toHaveProperty('error', 'Invalid subdomain format')
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { available: false, error: 'Invalid subdomain format' },
      { status: 400 }
    )
  })

  it('should return available=true when subdomain is valid and not in use', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    mockLimit.mockResolvedValue([])

    const req = new NextRequest(
      'http://localhost:3000/api/chat/subdomains/validate?subdomain=available-subdomain'
    )

    const { GET } = await import('./route')

    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
      available: true,
      subdomain: 'available-subdomain',
    })
  })

  it('should return available=false when subdomain is reserved', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    const req = new NextRequest(
      'http://localhost:3000/api/chat/subdomains/validate?subdomain=telemetry'
    )

    const { GET } = await import('./route')

    const response = await GET(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('available', false)
    expect(data).toHaveProperty('error', 'This subdomain is reserved')
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { available: false, error: 'This subdomain is reserved' },
      { status: 400 }
    )
  })

  it('should return available=false when subdomain is already in use', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    mockLimit.mockResolvedValue([{ id: 'existing-chat-id' }])

    const req = new NextRequest(
      'http://localhost:3000/api/chat/subdomains/validate?subdomain=used-subdomain'
    )

    const { GET } = await import('./route')

    const response = await GET(req)

    expect(response.status).toBe(200)
    expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
      available: false,
      subdomain: 'used-subdomain',
    })
  })

  it('should return 500 when database query fails', async () => {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    mockLimit.mockRejectedValue(new Error('Database error'))

    const req = new NextRequest(
      'http://localhost:3000/api/chat/subdomains/validate?subdomain=error-subdomain'
    )

    const { GET } = await import('./route')

    const response = await GET(req)

    expect(response.status).toBe(500)
    expect(mockCreateErrorResponse).toHaveBeenCalledWith(
      'Failed to check subdomain availability',
      500
    )
  })
})
