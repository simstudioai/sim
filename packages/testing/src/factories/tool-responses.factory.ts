/**
 * Mock Data for Tool Tests
 *
 * This file contains mock data samples to be used in tool unit tests.
 */

/**
 * HTTP Request mock responses for different scenarios.
 */
export const mockHttpResponses = {
  simple: {
    data: { message: 'Success', status: 'ok' },
    status: 200,
    headers: { 'content-type': 'application/json' },
  },
  error: {
    error: { message: 'Bad Request', code: 400 },
    status: 400,
  },
  notFound: {
    error: { message: 'Not Found', code: 404 },
    status: 404,
  },
  unauthorized: {
    error: { message: 'Unauthorized', code: 401 },
    status: 401,
  },
}
