/**
 * Mock request utilities for API testing
 */

/**
 * Creates a mock NextRequest for API route testing.
 * This is a general-purpose utility for testing Next.js API routes.
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param body - Optional request body (will be JSON stringified)
 * @param headers - Optional headers to include
 * @param url - Optional custom URL (defaults to http://localhost:3000/api/test)
 * @returns NextRequest instance
 *
 * @example
 * ```ts
 * const req = createMockRequest('POST', { name: 'test' })
 * const response = await POST(req)
 * ```
 */
export function createMockRequest(
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost:3000/api/test'
): Request {
  const init: RequestInit = {
    method,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request(new URL(url), init)
}

/**
 * Creates a mock NextRequest with form data for file upload testing.
 *
 * @param formData - FormData instance
 * @param method - HTTP method (defaults to POST)
 * @param url - Optional custom URL
 * @returns Request instance
 */
export function createMockFormDataRequest(
  formData: FormData,
  method = 'POST',
  url = 'http://localhost:3000/api/test'
): Request {
  return new Request(new URL(url), {
    method,
    body: formData,
  })
}
