/**
 * @vitest-environment jsdom
 *
 * Airtable Tools Integration Tests
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ToolTester } from '../__test-utils__/test-tools'
import { airtableReadTool, airtableUpdateTool, airtableWriteTool } from './index'

describe('Airtable Tools Integration', () => {
  let tester: ToolTester

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  })

  afterEach(() => {
    vi.resetAllMocks()
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  describe('Airtable Read Tool', () => {
    beforeEach(() => {
      tester = new ToolTester(airtableReadTool)
    })

    test('should construct correct read request', () => {
      const params = {
        baseId: 'base123',
        tableId: 'table456',
        accessToken: 'token789',
        maxRecords: 100,
        filterFormula: "Status='Active'",
      }

      const url = tester.getRequestUrl(params)
      const headers = tester.getRequestHeaders(params)

      expect(url).toContain('/base123/table456')
      expect(url).toContain('maxRecords=100')
      expect(url).toContain('filterByFormula=Status%3D%27Active%27')
      expect(headers['Authorization']).toBe('Bearer token789')
    })

    test('should handle successful read response', async () => {
      const mockData = {
        records: [
          { id: 'rec1', fields: { Name: 'Test 1' } },
          { id: 'rec2', fields: { Name: 'Test 2' } },
        ],
        offset: 'next_page_token',
      }

      tester.setup(mockData)

      const result = await tester.execute({
        baseId: 'base123',
        tableId: 'table456',
        accessToken: 'token789',
      })

      expect(result.success).toBe(true)
      expect(result.output.records).toHaveLength(2)
      expect(result.output.metadata.offset).toBe('next_page_token')
      expect(result.output.metadata.totalRecords).toBe(2)
    })
  })

  describe('Airtable Write Tool', () => {
    beforeEach(() => {
      tester = new ToolTester(airtableWriteTool)
    })

    test('should construct correct write request', () => {
      const params = {
        baseId: 'base123',
        tableId: 'table456',
        accessToken: 'token789',
        records: [{ fields: { Name: 'New Record' } }],
      }

      const url = tester.getRequestUrl(params)
      const headers = tester.getRequestHeaders(params)
      const body = tester.getRequestBody(params)

      expect(url).toContain('/base123/table456')
      expect(headers['Authorization']).toBe('Bearer token789')
      expect(body).toEqual({ records: [{ fields: { Name: 'New Record' } }] })
    })

    test('should handle successful write response', async () => {
      const mockData = {
        records: [{ id: 'rec1', fields: { Name: 'New Record' } }],
      }

      tester.setup(mockData)

      const result = await tester.execute({
        baseId: 'base123',
        tableId: 'table456',
        accessToken: 'token789',
        records: [{ fields: { Name: 'New Record' } }],
      })

      expect(result.success).toBe(true)
      expect(result.output.records).toHaveLength(1)
      expect(result.output.metadata.recordCount).toBe(1)
    })
  })

  describe('Airtable Update Tool', () => {
    beforeEach(() => {
      tester = new ToolTester(airtableUpdateTool)
    })

    test('should construct correct update request', () => {
      const params = {
        baseId: 'base123',
        tableId: 'table456',
        recordId: 'rec789',
        accessToken: 'token789',
        fields: { Name: 'Updated Record' },
      }

      const url = tester.getRequestUrl(params)
      const headers = tester.getRequestHeaders(params)
      const body = tester.getRequestBody(params)

      expect(url).toContain('/base123/table456/rec789')
      expect(headers['Authorization']).toBe('Bearer token789')
      expect(body).toEqual({ fields: { Name: 'Updated Record' } })
    })

    test('should handle successful update response', async () => {
      const mockData = {
        id: 'rec789',
        fields: { Name: 'Updated Record' },
      }

      tester.setup(mockData)

      const result = await tester.execute({
        baseId: 'base123',
        tableId: 'table456',
        recordId: 'rec789',
        accessToken: 'token789',
        fields: { Name: 'Updated Record' },
      })

      expect(result.success).toBe(true)
      expect(result.output.records).toHaveLength(1)
      expect(result.output.metadata.recordCount).toBe(1)
      expect(result.output.metadata.updatedFields).toContain('Name')
    })
  })

  test('should handle error responses', async () => {
    tester = new ToolTester(airtableReadTool)

    const errorMessage = 'Invalid API key'
    tester.setup({ error: errorMessage }, { ok: false, status: 401 })

    const result = await tester.execute({
      baseId: 'base123',
      tableId: 'table456',
      accessToken: 'invalid_token',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to read Airtable records')
  })
})
