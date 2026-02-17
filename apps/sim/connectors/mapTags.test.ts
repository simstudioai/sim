/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  JiraIcon: () => null,
  ConfluenceIcon: () => null,
  GithubIcon: () => null,
  LinearIcon: () => null,
  NotionIcon: () => null,
  GoogleDriveIcon: () => null,
  AirtableIcon: () => null,
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: vi.fn(),
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/tools/jira/utils', () => ({ extractAdfText: vi.fn(), getJiraCloudId: vi.fn() }))
vi.mock('@/tools/confluence/utils', () => ({ getConfluenceCloudId: vi.fn() }))

import { airtableConnector } from '@/connectors/airtable/airtable'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import { githubConnector } from '@/connectors/github/github'
import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import { jiraConnector } from '@/connectors/jira/jira'
import { linearConnector } from '@/connectors/linear/linear'
import { notionConnector } from '@/connectors/notion/notion'

const ISO_DATE = '2025-06-15T10:30:00.000Z'

describe('Jira mapTags', () => {
  const mapTags = jiraConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      issueType: 'Bug',
      status: 'In Progress',
      priority: 'High',
      labels: ['frontend', 'urgent'],
      assignee: 'Alice',
      updated: ISO_DATE,
    })

    expect(result).toEqual({
      issueType: 'Bug',
      status: 'In Progress',
      priority: 'High',
      labels: 'frontend, urgent',
      assignee: 'Alice',
      updated: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      issueType: 123,
      status: null,
      priority: undefined,
      assignee: true,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips updated when date string is invalid', () => {
    const result = mapTags({ updated: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips labels when not an array', () => {
    const result = mapTags({ labels: 'not-an-array' })
    expect(result).toEqual({})
  })

  it.concurrent('skips labels when array is empty', () => {
    const result = mapTags({ labels: [] })
    expect(result).toEqual({})
  })

  it.concurrent('skips updated when value is not a string', () => {
    const result = mapTags({ updated: 12345 })
    expect(result).toEqual({})
  })
})

describe('Confluence mapTags', () => {
  const mapTags = confluenceConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      labels: ['docs', 'published'],
      version: 5,
      lastModified: ISO_DATE,
    })

    expect(result).toEqual({
      labels: 'docs, published',
      version: 5,
      lastModified: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips labels when not an array', () => {
    const result = mapTags({ labels: 'single-label' })
    expect(result).toEqual({})
  })

  it.concurrent('skips version when NaN', () => {
    const result = mapTags({ version: 'abc' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string version to number', () => {
    const result = mapTags({ version: '3' })
    expect(result).toEqual({ version: 3 })
  })

  it.concurrent('skips lastModified when date is invalid', () => {
    const result = mapTags({ lastModified: 'garbage' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when not a string', () => {
    const result = mapTags({ lastModified: 12345 })
    expect(result).toEqual({})
  })
})

describe('GitHub mapTags', () => {
  const mapTags = githubConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      path: 'src/index.ts',
      repository: 'owner/repo',
      branch: 'main',
      size: 1024,
    })

    expect(result).toEqual({
      path: 'src/index.ts',
      repository: 'owner/repo',
      branch: 'main',
      size: 1024,
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips string fields with wrong types', () => {
    const result = mapTags({
      path: 42,
      repository: null,
      branch: true,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips size when NaN', () => {
    const result = mapTags({ size: 'not-a-number' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string size to number', () => {
    const result = mapTags({ size: '512' })
    expect(result).toEqual({ size: 512 })
  })

  it.concurrent('maps size of zero', () => {
    const result = mapTags({ size: 0 })
    expect(result).toEqual({ size: 0 })
  })
})

describe('Linear mapTags', () => {
  const mapTags = linearConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      labels: ['bug', 'p0'],
      state: 'In Progress',
      priority: 'Urgent',
      assignee: 'Bob',
      lastModified: ISO_DATE,
    })

    expect(result).toEqual({
      labels: 'bug, p0',
      state: 'In Progress',
      priority: 'Urgent',
      assignee: 'Bob',
      lastModified: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips string fields with wrong types', () => {
    const result = mapTags({
      state: 123,
      priority: false,
      assignee: [],
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips labels when not an array', () => {
    const result = mapTags({ labels: 'not-array' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when date is invalid', () => {
    const result = mapTags({ lastModified: 'invalid-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when not a string', () => {
    const result = mapTags({ lastModified: 99999 })
    expect(result).toEqual({})
  })
})

describe('Notion mapTags', () => {
  const mapTags = notionConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      tags: ['engineering', 'docs'],
      lastModified: ISO_DATE,
      createdTime: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      tags: 'engineering, docs',
      lastModified: new Date(ISO_DATE),
      created: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips tags when not an array', () => {
    const result = mapTags({ tags: 'single' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when date is invalid', () => {
    const result = mapTags({ lastModified: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips createdTime when date is invalid', () => {
    const result = mapTags({ createdTime: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips date fields when not strings', () => {
    const result = mapTags({ lastModified: 12345, createdTime: true })
    expect(result).toEqual({})
  })

  it.concurrent('maps createdTime to created key', () => {
    const result = mapTags({ createdTime: ISO_DATE })
    expect(result).toEqual({ created: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('createdTime')
  })
})

describe('Google Drive mapTags', () => {
  const mapTags = googleDriveConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      owners: ['Alice', 'Bob'],
      originalMimeType: 'application/vnd.google-apps.document',
      modifiedTime: ISO_DATE,
      starred: true,
    })

    expect(result).toEqual({
      owners: 'Alice, Bob',
      fileType: 'Google Doc',
      lastModified: new Date(ISO_DATE),
      starred: true,
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('maps spreadsheet mime type', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.spreadsheet' })
    expect(result).toEqual({ fileType: 'Google Sheet' })
  })

  it.concurrent('maps presentation mime type', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.presentation' })
    expect(result).toEqual({ fileType: 'Google Slides' })
  })

  it.concurrent('maps text/ mime types to Text File', () => {
    const result = mapTags({ originalMimeType: 'text/plain' })
    expect(result).toEqual({ fileType: 'Text File' })
  })

  it.concurrent('falls back to raw mime type for unknown types', () => {
    const result = mapTags({ originalMimeType: 'application/pdf' })
    expect(result).toEqual({ fileType: 'application/pdf' })
  })

  it.concurrent('skips owners when not an array', () => {
    const result = mapTags({ owners: 'not-an-array' })
    expect(result).toEqual({})
  })

  it.concurrent('skips modifiedTime when date is invalid', () => {
    const result = mapTags({ modifiedTime: 'garbage' })
    expect(result).toEqual({})
  })

  it.concurrent('skips modifiedTime when not a string', () => {
    const result = mapTags({ modifiedTime: 99999 })
    expect(result).toEqual({})
  })

  it.concurrent('maps starred false', () => {
    const result = mapTags({ starred: false })
    expect(result).toEqual({ starred: false })
  })

  it.concurrent('skips starred when not a boolean', () => {
    const result = mapTags({ starred: 'yes' })
    expect(result).toEqual({})
  })

  it.concurrent('maps modifiedTime to lastModified key', () => {
    const result = mapTags({ modifiedTime: ISO_DATE })
    expect(result).toEqual({ lastModified: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('modifiedTime')
  })

  it.concurrent('maps originalMimeType to fileType key', () => {
    const result = mapTags({ originalMimeType: 'application/vnd.google-apps.document' })
    expect(result).toEqual({ fileType: 'Google Doc' })
    expect(result).not.toHaveProperty('originalMimeType')
  })
})

describe('Airtable mapTags', () => {
  const mapTags = airtableConnector.mapTags!

  it.concurrent('maps createdTime when present', () => {
    const result = mapTags({ createdTime: ISO_DATE })
    expect(result).toEqual({ createdTime: new Date(ISO_DATE) })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips createdTime when date is invalid', () => {
    const result = mapTags({ createdTime: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips createdTime when not a string', () => {
    const result = mapTags({ createdTime: 12345 })
    expect(result).toEqual({})
  })

  it.concurrent('ignores unrelated metadata fields', () => {
    const result = mapTags({ foo: 'bar', count: 42, createdTime: ISO_DATE })
    expect(result).toEqual({ createdTime: new Date(ISO_DATE) })
  })
})
