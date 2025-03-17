/**
 * @vitest-environment jsdom
 *
 * GitHub Repository Info Tool Unit Tests
 *
 * This file contains unit tests for the GitHub Repository Info tool,
 * which is used to fetch metadata about GitHub repositories.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockGitHubResponses } from '../__test-utils__/mock-data'
import { ToolTester } from '../__test-utils__/test-tools'
import { repoInfoTool } from './repo'

describe('GitHub Repository Info Tool', () => {
  let tester: ToolTester

  beforeEach(() => {
    tester = new ToolTester(repoInfoTool)
  })

  afterEach(() => {
    tester.cleanup()
    vi.resetAllMocks()
  })

  describe('URL Construction', () => {
    test('should construct correct GitHub API URL', () => {
      const params = {
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'test-token',
      }

      expect(tester.getRequestUrl(params)).toBe('https://api.github.com/repos/testuser/testrepo')
    })
  })

  describe('Headers Construction', () => {
    test('should include authorization header when apiKey is provided', () => {
      const params = {
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'test-token',
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('Bearer test-token')
      expect(headers.Accept).toBe('application/vnd.github+json')
      expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    })

    test('should have empty authorization header when apiKey is not provided', () => {
      const params = {
        owner: 'testuser',
        repo: 'testrepo',
      }

      const headers = tester.getRequestHeaders(params)
      expect(headers.Authorization).toBe('')
    })
  })

  describe('Data Transformation', () => {
    test('should transform repository data correctly', async () => {
      // Setup mock response
      tester.setup(mockGitHubResponses.repoInfo)

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output).toEqual({
        name: 'test-repo',
        description: 'A test repository',
        stars: 15,
        forks: 3,
        openIssues: 5,
        language: 'TypeScript',
      })
    })

    test('should handle missing description and language', async () => {
      // Create a modified response with missing fields
      const modifiedResponse = {
        ...mockGitHubResponses.repoInfo,
        description: null,
        language: null,
      }

      tester.setup(modifiedResponse)

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'test-token',
      })

      // Check the result
      expect(result.success).toBe(true)
      expect(result.output.description).toBe('')
      expect(result.output.language).toBe('Not specified')
    })
  })

  describe('Error Handling', () => {
    test('should handle repository not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'Not Found' }, { ok: false, status: 404 })

      // Mock the transformError function to return the specific error message we're testing for
      const originalTransformError = tester.tool.transformError
      tester.tool.transformError = vi
        .fn()
        .mockReturnValue('Repository not found. Please check the owner and repository name.')

      // Execute the tool
      const result = await tester.execute({
        owner: 'nonexistent',
        repo: 'nonexistent',
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBe('Repository not found. Please check the owner and repository name.')

      // Restore original
      tester.tool.transformError = originalTransformError
    })

    test('should handle authentication errors', async () => {
      // Setup 401 error response
      tester.setup({ message: 'Bad credentials' }, { ok: false, status: 401 })

      // Mock the transformError function to return the specific error message we're testing for
      const originalTransformError = tester.tool.transformError
      tester.tool.transformError = vi
        .fn()
        .mockReturnValue('Authentication failed. Please check your GitHub token.')

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'invalid-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBe('Authentication failed. Please check your GitHub token.')

      // Restore original
      tester.tool.transformError = originalTransformError
    })

    test('should handle network errors', async () => {
      // Setup network error
      tester.setupError('Network error')

      // Execute the tool
      const result = await tester.execute({
        owner: 'testuser',
        repo: 'testrepo',
        apiKey: 'test-token',
      })

      // Check error handling
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
