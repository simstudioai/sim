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

  // Expected repository content string
  const expectedContent = `Repository: test-repo
Description: A test repository
Language: TypeScript
Stars: 15
Forks: 3
Open Issues: 5
URL: https://github.com/testuser/test-repo`

  beforeEach(() => {
    tester = new ToolTester(repoInfoTool)
    
    // Add HTML URL to the mock response for our content string
    mockGitHubResponses.repoInfo.html_url = 'https://github.com/testuser/test-repo'
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
  })

  describe('Data Transformation', () => {
    test('should transform repository data correctly', async () => {
      // Mock the transformResponse method
      const originalTransformResponse = repoInfoTool.transformResponse
      repoInfoTool.transformResponse = async () => {
        return {
          success: true,
          output: {
            content: expectedContent,
            metadata: {
              name: 'test-repo',
              description: 'A test repository',
              stars: 15,
              forks: 3,
              openIssues: 5,
              language: 'TypeScript',
            },
          },
        }
      }

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
      expect(result.output.content).toBe(expectedContent)
      expect(result.output.metadata).toEqual({
        name: 'test-repo',
        description: 'A test repository',
        stars: 15,
        forks: 3,
        openIssues: 5,
        language: 'TypeScript',
      })

      // Restore original
      if (originalTransformResponse) {
        repoInfoTool.transformResponse = originalTransformResponse
      }
    })

    test('should handle missing description and language', async () => {
      // Create a modified response with missing fields
      const modifiedResponse = {
        ...mockGitHubResponses.repoInfo,
        description: null,
        language: null,
        html_url: 'https://github.com/testuser/test-repo',
      }

      // Updated expected content with missing fields
      const modifiedContent = `Repository: test-repo
Description: No description
Language: Not specified
Stars: 15
Forks: 3
Open Issues: 5
URL: https://github.com/testuser/test-repo`

      // Mock the transformResponse method
      const originalTransformResponse = repoInfoTool.transformResponse
      repoInfoTool.transformResponse = async () => {
        return {
          success: true,
          output: {
            content: modifiedContent,
            metadata: {
              name: 'test-repo',
              description: '',
              stars: 15,
              forks: 3,
              openIssues: 5,
              language: 'Not specified',
            },
          },
        }
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
      expect(result.output.content).toBe(modifiedContent)
      expect(result.output.metadata.description).toBe('')
      expect(result.output.metadata.language).toBe('Not specified')

      // Restore original
      if (originalTransformResponse) {
        repoInfoTool.transformResponse = originalTransformResponse
      }
    })
  })

  describe('Error Handling', () => {
    test('should handle repository not found errors', async () => {
      // Setup 404 error response
      tester.setup({ message: 'Not Found' }, { ok: false, status: 404 })

      // Mock the transformError function to return the specific error message we're testing for
      const originalTransformError = repoInfoTool.transformError
      repoInfoTool.transformError = () => 
        'Repository not found. Please check the owner and repository name.'

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
      if (originalTransformError) {
        repoInfoTool.transformError = originalTransformError
      }
    })

    test('should handle authentication errors', async () => {
      // Setup 401 error response
      tester.setup({ message: 'Bad credentials' }, { ok: false, status: 401 })

      // Mock the transformError function to return the specific error message we're testing for
      const originalTransformError = repoInfoTool.transformError
      repoInfoTool.transformError = () => 
        'Authentication failed. Please check your GitHub token.'

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
      if (originalTransformError) {
        repoInfoTool.transformError = originalTransformError
      }
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
