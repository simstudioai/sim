/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExternalDocument } from '@/connectors/types'

vi.mock('@/components/icons', () => ({
  JiraIcon: () => null,
  ConfluenceIcon: () => null,
  GithubIcon: () => null,
  LinearIcon: () => null,
  NotionIcon: () => null,
  GoogleDriveIcon: () => null,
  AirtableIcon: () => null,
  SentryIcon: () => null,
  TypeformIcon: () => null,
  YouTubeIcon: () => null,
  JiraServiceManagementIcon: () => null,
  S3Icon: () => null,
  GoogleFormsIcon: () => null,
  xIcon: () => null,
  GranolaIcon: () => null,
  GreenhouseIcon: () => null,
  FathomIcon: () => null,
  RootlyIcon: () => null,
  AzureIcon: () => null,
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: vi.fn(),
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/tools/jira/utils', () => ({ extractAdfText: vi.fn(), getJiraCloudId: vi.fn() }))
vi.mock('@/tools/confluence/utils', () => ({ getConfluenceCloudId: vi.fn() }))
vi.mock('@/tools/jsm/utils', () => ({
  getJsmApiBaseUrl: vi.fn(),
  getJsmFormsApiBaseUrl: vi.fn(),
  getJsmHeaders: vi.fn(),
}))
vi.mock('@/tools/s3/utils', () => ({
  encodeS3PathComponent: vi.fn(),
  getSignatureKey: vi.fn(),
  parseS3Uri: vi.fn(),
  generatePresignedUrl: vi.fn(),
}))

import { airtableConnector } from '@/connectors/airtable/airtable'
import { azureDevopsConnector } from '@/connectors/azure-devops/azure-devops'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import { fathomConnector } from '@/connectors/fathom/fathom'
import { githubConnector } from '@/connectors/github/github'
import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import { googleFormsConnector } from '@/connectors/google-forms/google-forms'
import { granolaConnector } from '@/connectors/granola/granola'
import { greenhouseConnector } from '@/connectors/greenhouse/greenhouse'
import { jiraConnector } from '@/connectors/jira/jira'
import { jsmConnector } from '@/connectors/jsm/jsm'
import { linearConnector } from '@/connectors/linear/linear'
import { notionConnector } from '@/connectors/notion/notion'
import { rootlyConnector } from '@/connectors/rootly/rootly'
import { s3Connector } from '@/connectors/s3/s3'
import { sentryConnector } from '@/connectors/sentry/sentry'
import { typeformConnector } from '@/connectors/typeform/typeform'
import {
  ConnectorFileTooLargeError,
  isSkippedDocument,
  markSkipped,
  readBodyWithLimit,
  sizeLimitSkipReason,
  takeIndexableWithinCap,
} from '@/connectors/utils'
import { xConnector } from '@/connectors/x/x'
import { youtubeConnector } from '@/connectors/youtube/youtube'

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

describe('Sentry mapTags', () => {
  const mapTags = sentryConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      level: 'error',
      status: 'unresolved',
      count: 1234,
      firstSeen: '2025-01-01T00:00:00.000Z',
      lastSeen: ISO_DATE,
    })

    expect(result).toEqual({
      level: 'error',
      status: 'unresolved',
      count: 1234,
      firstSeen: new Date('2025-01-01T00:00:00.000Z'),
      lastSeen: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      level: 123,
      status: null,
      count: 'not-a-number',
      firstSeen: 'bad-date',
      lastSeen: 99999,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips blank string fields', () => {
    const result = mapTags({ level: '   ', status: '' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string count to number', () => {
    const result = mapTags({ count: '42' })
    expect(result).toEqual({ count: 42 })
  })

  it.concurrent('maps count of zero', () => {
    const result = mapTags({ count: 0 })
    expect(result).toEqual({ count: 0 })
  })
})

describe('Typeform mapTags', () => {
  const mapTags = typeformConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      formTitle: 'Customer Survey',
      platform: 'web',
      submittedAt: ISO_DATE,
    })

    expect(result).toEqual({
      formTitle: 'Customer Survey',
      platform: 'web',
      submittedAt: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      formTitle: 123,
      platform: null,
      submittedAt: 99999,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips submittedAt when date is invalid', () => {
    const result = mapTags({ submittedAt: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips empty string fields', () => {
    const result = mapTags({ formTitle: '', platform: '' })
    expect(result).toEqual({})
  })
})

describe('YouTube mapTags', () => {
  const mapTags = youtubeConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      channelTitle: 'Tech Channel',
      publishedAt: ISO_DATE,
      duration: 'PT10M30S',
      tags: ['tutorial', 'coding'],
    })

    expect(result).toEqual({
      channelTitle: 'Tech Channel',
      publishedAt: new Date(ISO_DATE),
      duration: 'PT10M30S',
      tags: 'tutorial, coding',
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      channelTitle: 123,
      publishedAt: 99999,
      duration: null,
      tags: 'not-an-array',
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips publishedAt when date is invalid', () => {
    const result = mapTags({ publishedAt: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips blank string fields', () => {
    const result = mapTags({ channelTitle: '  ', duration: '' })
    expect(result).toEqual({})
  })

  it.concurrent('skips tags when array is empty', () => {
    const result = mapTags({ tags: [] })
    expect(result).toEqual({})
  })
})

describe('JSM mapTags', () => {
  const mapTags = jsmConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      status: 'Waiting for support',
      requestTypeId: 'rt-123',
      reporter: 'Carol',
      created: '2025-01-01T00:00:00.000Z',
      statusDate: ISO_DATE,
    })

    expect(result).toEqual({
      status: 'Waiting for support',
      requestTypeId: 'rt-123',
      reporter: 'Carol',
      created: new Date('2025-01-01T00:00:00.000Z'),
      updated: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      status: 123,
      requestTypeId: null,
      reporter: true,
      created: 'bad-date',
      statusDate: 99999,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips created when date is invalid', () => {
    const result = mapTags({ created: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('maps statusDate to updated key', () => {
    const result = mapTags({ statusDate: ISO_DATE })
    expect(result).toEqual({ updated: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('statusDate')
  })
})

describe('S3 mapTags', () => {
  const mapTags = s3Connector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      prefix: 'documents/reports/',
      fileSize: 2048,
      lastModified: ISO_DATE,
    })

    expect(result).toEqual({
      prefix: 'documents/reports/',
      fileSize: 2048,
      lastModified: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      prefix: 123,
      fileSize: 'not-a-number',
      lastModified: 99999,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips prefix when empty string', () => {
    const result = mapTags({ prefix: '' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastModified when date is invalid', () => {
    const result = mapTags({ lastModified: 'bad-date' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string fileSize to number', () => {
    const result = mapTags({ fileSize: '512' })
    expect(result).toEqual({ fileSize: 512 })
  })

  it.concurrent('maps fileSize of zero', () => {
    const result = mapTags({ fileSize: 0 })
    expect(result).toEqual({ fileSize: 0 })
  })
})

describe('Google Forms mapTags', () => {
  const mapTags = googleFormsConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      formTitle: 'Feedback Form',
      owners: ['Alice', 'Bob'],
      modifiedTime: ISO_DATE,
      latestResponseTime: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      formTitle: 'Feedback Form',
      owners: 'Alice, Bob',
      lastModified: new Date(ISO_DATE),
      lastResponse: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      formTitle: 123,
      owners: 'not-an-array',
      modifiedTime: 99999,
      latestResponseTime: false,
    })
    expect(result).toEqual({})
  })

  it.concurrent('trims formTitle in output', () => {
    const result = mapTags({ formTitle: '  Feedback Form  ' })
    expect(result).toEqual({ formTitle: 'Feedback Form' })
  })

  it.concurrent('skips formTitle when blank', () => {
    const result = mapTags({ formTitle: '   ' })
    expect(result).toEqual({})
  })

  it.concurrent('skips owners when array is empty', () => {
    const result = mapTags({ owners: [] })
    expect(result).toEqual({})
  })

  it.concurrent('maps modifiedTime to lastModified key', () => {
    const result = mapTags({ modifiedTime: ISO_DATE })
    expect(result).toEqual({ lastModified: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('modifiedTime')
  })

  it.concurrent('maps latestResponseTime to lastResponse key', () => {
    const result = mapTags({ latestResponseTime: ISO_DATE })
    expect(result).toEqual({ lastResponse: new Date(ISO_DATE) })
    expect(result).not.toHaveProperty('latestResponseTime')
  })
})

describe('Azure DevOps mapTags', () => {
  const mapTags = azureDevopsConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      kind: 'workItem',
      wikiName: 'Engineering Wiki',
      workItemType: 'Bug',
      state: 'Active',
      areaPath: 'Project\\Team',
      tags: ['frontend', 'urgent'],
      repository: 'owner/repo',
      path: 'src/index.ts',
      changedDate: ISO_DATE,
    })

    expect(result).toEqual({
      kind: 'workItem',
      wikiName: 'Engineering Wiki',
      workItemType: 'Bug',
      state: 'Active',
      areaPath: 'Project\\Team',
      tags: 'frontend, urgent',
      repository: 'owner/repo',
      path: 'src/index.ts',
      changedDate: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      kind: 123,
      wikiName: null,
      workItemType: true,
      state: [],
      areaPath: 99999,
      tags: 'not-an-array',
      repository: false,
      path: 42,
      changedDate: 'bad-date',
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips empty string fields except kind', () => {
    const result = mapTags({
      kind: '',
      wikiName: '',
      workItemType: '',
      state: '',
      areaPath: '',
      repository: '',
      path: '',
    })
    expect(result).toEqual({ kind: '' })
  })

  it.concurrent('skips tags when array is empty', () => {
    const result = mapTags({ tags: [] })
    expect(result).toEqual({})
  })

  it.concurrent('skips changedDate when date is invalid', () => {
    const result = mapTags({ changedDate: 'garbage' })
    expect(result).toEqual({})
  })
})

describe('X mapTags', () => {
  const mapTags = xConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      author: 'jack',
      createdAt: ISO_DATE,
      likeCount: 1500,
      retweetCount: 300,
    })

    expect(result).toEqual({
      author: 'jack',
      createdAt: new Date(ISO_DATE),
      likeCount: 1500,
      retweetCount: 300,
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      author: 123,
      createdAt: 99999,
      likeCount: 'not-a-number',
      retweetCount: 'nope',
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips createdAt when date is invalid', () => {
    const result = mapTags({ createdAt: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string counts to numbers', () => {
    const result = mapTags({ likeCount: '42', retweetCount: '7' })
    expect(result).toEqual({ likeCount: 42, retweetCount: 7 })
  })

  it.concurrent('maps counts of zero', () => {
    const result = mapTags({ likeCount: 0, retweetCount: 0 })
    expect(result).toEqual({ likeCount: 0, retweetCount: 0 })
  })
})

describe('Granola mapTags', () => {
  const mapTags = granolaConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      title: 'Weekly Sync',
      owner: 'Alice',
      attendees: ['Alice', 'Bob'],
      folders: ['Team', 'Projects'],
      meeting: 'Q3 Planning',
      noteDate: ISO_DATE,
      meetingDate: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      title: 'Weekly Sync',
      owner: 'Alice',
      attendees: 'Alice, Bob',
      folders: 'Team, Projects',
      meeting: 'Q3 Planning',
      noteDate: new Date(ISO_DATE),
      meetingDate: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      title: 123,
      owner: null,
      attendees: 'not-an-array',
      folders: 'not-an-array',
      meeting: true,
      noteDate: 99999,
      meetingDate: false,
    })
    expect(result).toEqual({})
  })

  it.concurrent('trims text fields in output', () => {
    const result = mapTags({ title: '  Weekly Sync  ', owner: '  Alice  ', meeting: '  Q3  ' })
    expect(result).toEqual({ title: 'Weekly Sync', owner: 'Alice', meeting: 'Q3' })
  })

  it.concurrent('skips blank text fields', () => {
    const result = mapTags({ title: '   ', owner: '', meeting: '  ' })
    expect(result).toEqual({})
  })

  it.concurrent('skips array fields when empty', () => {
    const result = mapTags({ attendees: [], folders: [] })
    expect(result).toEqual({})
  })

  it.concurrent('skips noteDate when date is invalid', () => {
    const result = mapTags({ noteDate: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips meetingDate when date is invalid', () => {
    const result = mapTags({ meetingDate: 'garbage' })
    expect(result).toEqual({})
  })
})

describe('Greenhouse mapTags', () => {
  const mapTags = greenhouseConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      candidateName: 'Jane Doe',
      company: 'Acme',
      title: 'Engineer',
      recruiter: 'Alice',
      coordinator: 'Bob',
      source: 'LinkedIn',
      applicationCount: 3,
      updatedAt: ISO_DATE,
      lastActivity: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      candidateName: 'Jane Doe',
      company: 'Acme',
      title: 'Engineer',
      recruiter: 'Alice',
      coordinator: 'Bob',
      source: 'LinkedIn',
      applicationCount: 3,
      updatedAt: new Date(ISO_DATE),
      lastActivity: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      candidateName: 123,
      company: null,
      title: true,
      recruiter: [],
      coordinator: false,
      source: 99999,
      applicationCount: 'not-a-number',
      updatedAt: 12345,
      lastActivity: 'bad-date',
    })
    expect(result).toEqual({})
  })

  it.concurrent('trims text fields in output', () => {
    const result = mapTags({ candidateName: '  Jane Doe  ', company: '  Acme  ' })
    expect(result).toEqual({ candidateName: 'Jane Doe', company: 'Acme' })
  })

  it.concurrent('skips blank text fields', () => {
    const result = mapTags({ candidateName: '   ', company: '', source: '  ' })
    expect(result).toEqual({})
  })

  it.concurrent('maps applicationCount of zero', () => {
    const result = mapTags({ applicationCount: 0 })
    expect(result).toEqual({ applicationCount: 0 })
  })

  it.concurrent('skips applicationCount when string', () => {
    const result = mapTags({ applicationCount: '3' })
    expect(result).toEqual({})
  })

  it.concurrent('skips updatedAt when date is invalid', () => {
    const result = mapTags({ updatedAt: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips lastActivity when date is invalid', () => {
    const result = mapTags({ lastActivity: 'garbage' })
    expect(result).toEqual({})
  })
})

describe('Fathom mapTags', () => {
  const mapTags = fathomConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      title: 'Sales Call',
      recordedByEmail: 'john@example.com',
      recordedByName: 'John Smith',
      team: 'Sales',
      meetingType: 'external',
      transcriptLanguage: 'en',
      durationSeconds: 1800,
      meetingDate: ISO_DATE,
    })

    expect(result).toEqual({
      title: 'Sales Call',
      recordedByEmail: 'john@example.com',
      recordedByName: 'John Smith',
      team: 'Sales',
      meetingType: 'external',
      transcriptLanguage: 'en',
      durationSeconds: 1800,
      meetingDate: new Date(ISO_DATE),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      title: 123,
      recordedByEmail: null,
      recordedByName: true,
      team: [],
      meetingType: false,
      transcriptLanguage: 99999,
      durationSeconds: 'not-a-number',
      meetingDate: 12345,
    })
    expect(result).toEqual({})
  })

  it.concurrent('skips blank string fields', () => {
    const result = mapTags({ title: '   ', team: '', transcriptLanguage: '  ' })
    expect(result).toEqual({})
  })

  it.concurrent('converts string durationSeconds to number', () => {
    const result = mapTags({ durationSeconds: '900' })
    expect(result).toEqual({ durationSeconds: 900 })
  })

  it.concurrent('maps durationSeconds of zero', () => {
    const result = mapTags({ durationSeconds: 0 })
    expect(result).toEqual({ durationSeconds: 0 })
  })

  it.concurrent('skips meetingDate when date is invalid', () => {
    const result = mapTags({ meetingDate: 'not-a-date' })
    expect(result).toEqual({})
  })
})

describe('Rootly mapTags', () => {
  const mapTags = rootlyConnector.mapTags!

  it.concurrent('maps all fields when present', () => {
    const result = mapTags({
      status: 'resolved',
      severityName: 'SEV1',
      kind: 'incident',
      services: ['api', 'web'],
      teams: ['platform'],
      environments: ['production'],
      labels: ['platform:osx'],
      incidentDate: ISO_DATE,
      resolvedDate: '2025-01-01T00:00:00.000Z',
    })

    expect(result).toEqual({
      status: 'resolved',
      severity: 'SEV1',
      kind: 'incident',
      services: 'api, web',
      teams: 'platform',
      environments: 'production',
      labels: 'platform:osx',
      incidentDate: new Date(ISO_DATE),
      resolvedDate: new Date('2025-01-01T00:00:00.000Z'),
    })
  })

  it.concurrent('returns empty object for empty metadata', () => {
    expect(mapTags({})).toEqual({})
  })

  it.concurrent('skips fields with wrong types', () => {
    const result = mapTags({
      status: 123,
      severityName: null,
      severityLevel: true,
      kind: [],
      services: 'not-an-array',
      teams: 'not-an-array',
      environments: 'not-an-array',
      labels: 'not-an-array',
      incidentDate: 99999,
      resolvedDate: false,
    })
    expect(result).toEqual({})
  })

  it.concurrent('falls back to severityLevel when severityName is absent', () => {
    const result = mapTags({ severityLevel: 'sev0' })
    expect(result).toEqual({ severity: 'sev0' })
  })

  it.concurrent('prefers severityName over severityLevel', () => {
    const result = mapTags({ severityName: 'Critical', severityLevel: 'sev0' })
    expect(result).toEqual({ severity: 'Critical' })
  })

  it.concurrent('skips array fields when empty', () => {
    const result = mapTags({ services: [], teams: [], environments: [], labels: [] })
    expect(result).toEqual({})
  })

  it.concurrent('skips incidentDate when date is invalid', () => {
    const result = mapTags({ incidentDate: 'not-a-date' })
    expect(result).toEqual({})
  })

  it.concurrent('skips resolvedDate when date is invalid', () => {
    const result = mapTags({ resolvedDate: 'garbage' })
    expect(result).toEqual({})
  })
})

function streamResponse(chunks: Uint8Array[], onCancel?: () => void): Response {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++])
      } else {
        controller.close()
      }
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Response(stream)
}

describe('readBodyWithLimit', () => {
  it('returns the full buffer when the streamed body is within the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 4096)
    expect(result).not.toBeNull()
    expect(result?.byteLength).toBe(2048)
  })

  it('returns the buffer when the body is exactly at the cap', async () => {
    const chunk = new Uint8Array(1024).fill(65)
    const result = await readBodyWithLimit(streamResponse([chunk, chunk]), 2048)
    expect(result?.byteLength).toBe(2048)
  })

  it('returns null and cancels the stream once the cap is exceeded', async () => {
    const onCancel = vi.fn()
    const chunk = new Uint8Array(1024).fill(65)
    // Cap is 2048; the third 1KB chunk pushes the total to 3072 and trips the cap,
    // so the remaining body is never buffered into memory.
    const result = await readBodyWithLimit(streamResponse([chunk, chunk, chunk], onCancel), 2048)
    expect(result).toBeNull()
    expect(onCancel).toHaveBeenCalled()
  })

  it('enforces the cap on bodyless responses via the arrayBuffer fallback', async () => {
    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const oversized = {
      body: null,
      arrayBuffer: async () => new Uint8Array(5000).buffer,
    } as unknown as Response
    expect(await readBodyWithLimit(oversized, 4096)).toBeNull()

    // double-cast-allowed: minimal response stub exercising the no-stream branch
    const within = {
      body: null,
      arrayBuffer: async () => new Uint8Array(100).buffer,
    } as unknown as Response
    expect((await readBodyWithLimit(within, 4096))?.byteLength).toBe(100)
  })
})

describe('markSkipped', () => {
  const stub: ExternalDocument = {
    externalId: 'file-1',
    title: 'big.csv',
    content: 'should be cleared',
    contentDeferred: true,
    mimeType: 'text/csv',
    sourceUrl: 'https://example.com/big.csv',
    contentHash: 'hash-1',
    metadata: { fileSize: 20_000_000, path: '/big.csv' },
  }

  it('clears content and flags the stub as skipped while preserving identity', () => {
    const skipped = markSkipped(stub, sizeLimitSkipReason(10 * 1024 * 1024))
    expect(skipped.content).toBe('')
    expect(skipped.contentDeferred).toBe(false)
    expect(skipped.skippedReason).toBe('File exceeds the 10MB size limit and was not indexed')
    // Identity/metadata preserved so change detection + tags still work.
    expect(skipped.externalId).toBe('file-1')
    expect(skipped.contentHash).toBe('hash-1')
    expect(skipped.sourceUrl).toBe('https://example.com/big.csv')
    expect(skipped.metadata).toEqual({ fileSize: 20_000_000, path: '/big.csv' })
  })

  it('does not mutate the original stub', () => {
    markSkipped(stub, 'too big')
    expect(stub.content).toBe('should be cleared')
    expect(stub.skippedReason).toBeUndefined()
  })
})

describe('ConnectorFileTooLargeError', () => {
  it('carries the limit and is catchable by type', () => {
    const error = new ConnectorFileTooLargeError(100 * 1024 * 1024)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ConnectorFileTooLargeError)
    expect(error.limitBytes).toBe(100 * 1024 * 1024)
    expect(error.message).toContain('100MB')
  })
})

describe('isSkippedDocument', () => {
  const base: ExternalDocument = {
    externalId: 'f1',
    title: 'f1',
    content: '',
    contentDeferred: false,
    mimeType: 'text/plain',
    contentHash: 'h',
    metadata: {},
  }

  it('is true only for a markSkipped stub', () => {
    expect(isSkippedDocument(base)).toBe(false)
    expect(isSkippedDocument(markSkipped(base, 'too big'))).toBe(true)
  })
})

describe('takeIndexableWithinCap', () => {
  const skip = (id: number) => ({ id, skip: true })
  const file = (id: number) => ({ id, skip: false })
  const isSkip = (i: { skip: boolean }) => i.skip

  it('passes everything through when the cap is unlimited', () => {
    const res = takeIndexableWithinCap([file(1), skip(2), file(3)], isSkip, 0, 0)
    expect(res.documents).toHaveLength(3)
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(false)
  })

  it('does not count skipped items against the cap', () => {
    const res = takeIndexableWithinCap([skip(1), skip(2), file(3), file(4), file(5)], isSkip, 2, 0)
    // both skips + the first two files emitted; the third file is beyond the cap
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('keeps emitting indexable docs even when oversized files crowd the front', () => {
    // Regression guard: an oversized prefix must not starve the indexable budget.
    const res = takeIndexableWithinCap([skip(1), skip(2), skip(3), file(4), file(5)], isSkip, 2, 0)
    expect(res.documents.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('stops once the indexable quota is met, dropping trailing items', () => {
    const res = takeIndexableWithinCap([file(1), file(2), file(3), file(4)], isSkip, 2, 0)
    expect(res.documents.map((i) => i.id)).toEqual([1, 2])
    expect(res.indexableCount).toBe(2)
    expect(res.capReached).toBe(true)
  })

  it('accounts for indexable docs already counted on previous pages', () => {
    const res = takeIndexableWithinCap([file(1), file(2), file(3)], isSkip, 5, 4)
    // only one indexable slot remains (5 - 4)
    expect(res.documents.map((i) => i.id)).toEqual([1])
    expect(res.indexableCount).toBe(1)
    expect(res.capReached).toBe(true)
  })

  it('emits nothing once the cap is already reached', () => {
    const res = takeIndexableWithinCap([skip(1), file(2)], isSkip, 3, 3)
    expect(res.documents).toHaveLength(0)
    expect(res.indexableCount).toBe(0)
    expect(res.capReached).toBe(true)
  })
})
