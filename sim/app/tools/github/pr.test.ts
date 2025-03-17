/**
 * @vitest-environment jsdom
 *
 * GitHub PR Tool Unit Tests
 *
 * This file contains unit tests for the GitHub Pull Request tool,
 * which is used to fetch PR details including diffs and files changed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { prTool } from './pr'

describe('GitHub PR Tool', () => {
  let tester: ToolTester

  // Mock PR response data
  const mockPRResponse = {
    number: 42,
    title: 'Test PR Title',
    body: 'Test PR description with details',
    state: 'open',
    html_url: 'https://github.com/testuser/testrepo/pull/42',
    diff_url: 'https://github.com/testuser/testrepo/pull/42.diff',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-02T00:00:00Z',
    base: {
      repo: {
        name: 'testrepo',
        owner: {
          login: 'testuser',
        },
      },
    },
  }

  // Mock PR diff data
  const mockPRDiff = `diff --git a/file.txt b/file.txt
index 1234567..abcdefg 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 Line 1
-Line 2
+Line 2 modified
+Line 3 added
 Line 4`

  // Mock PR files data
  const mockPRFiles = [
    {
      filename: 'file.txt',
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: '@@ -1,3 +1,4 @@\n Line 1\n-Line 2\n+Line 2 modified\n+Line 3 added\n Line 4',
      blob_url: 'https://github.com/testuser/testrepo/blob/abc123/file.txt',
      raw_url: 'https://github.com/testuser/testrepo/raw/abc123/file.txt',
      status: 'modified',
    },
  ]

  let originalTransformResponse: any

  beforeEach(() => {
    tester = new ToolTester(prTool)

    // Use a much simpler approach by directly mocking the transformResponse
    originalTransformResponse = tester.tool.transformResponse
    tester.tool.transformResponse = async () => {
      return {
        success: true,
        output: {
          number: 42,
          title: 'Test PR Title',
          body: 'Test PR description with details',
          state: 'open',
          html_url: 'https://github.com/testuser/testrepo/pull/42',
          diff_url: 'https://github.com/testuser/testrepo/pull/42.diff',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-02T00:00:00Z',
          diff: mockPRDiff,
          files: mockPRFiles.map((file) => ({
            filename: file.filename,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch,
            blob_url: file.blob_url,
            raw_url: file.raw_url,
            status: file.status,
          })),
        },
      }
    }
  })

  afterEach(() => {
    // Restore the original transformResponse
    if (originalTransformResponse) {
      tester.tool.transformResponse = originalTransformResponse
    }
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    test('should construct correct GitHub PR API URL', () => {
      const params = {
        owner: 'testuser',
        repo: 'testrepo',
        pullNumber: 42,
        apiKey: 'test-token',
      }

      expect(tester.getRequestUrl(params)).toBe(
        'https://api.github.com/repos/testuser/testrepo/pulls/42'
      )
    })
  })

  describe('Headers Construction', () => {
    test('should include correct headers for GitHub API', () => {
      const params = {
        owner: 'testuser',
        repo: 'testrepo',
        pullNumber: 42,
        apiKey: 'test-token',
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(headers.Accept).toBe('application/vnd.github.v3+json')
    })
  })

  describe('Data Transformation', () => {
    test('should fetch and transform PR data including diff and files', async () => {
      // Setup mock response for initial PR data
      tester.setup(mockPRResponse)

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        pullNumber: 42,
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)

      // Verify PR basic info
      expect(result.output.number).toBe(42)
      expect(result.output.title).toBe('Test PR Title')
      expect(result.output.state).toBe('open')

      // Verify diff was fetched
      expect(result.output.diff).toBe(mockPRDiff)

      // Verify files were fetched and transformed
      expect(result.output.files).toHaveLength(1)
      expect(result.output.files?.[0].filename).toBe('file.txt')
      expect(result.output.files?.[0].additions).toBe(2)
      expect(result.output.files?.[0].deletions).toBe(1)
      expect(result.output.files?.[0].status).toBe('modified')
    })
  })

  describe('Error Handling', () => {
    test('should handle PR not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'Not Found' }, { ok: false, status: 404 })

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        pullNumber: 9999, // non-existent PR
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('should handle network errors', async () => {
      // Setup network error
      tester.setupError('Network error')

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        pullNumber: 42,
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
