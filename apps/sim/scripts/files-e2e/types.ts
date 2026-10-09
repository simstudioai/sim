import type { Page } from '@playwright/test'
import type postgres from 'postgres'

export interface FilesE2EFixture {
  ownerId: string
  orgId: string
  workspaceId: string
  cookie: string
}

export interface FilesE2ERequestOptions {
  method?: string
  body?: unknown
  expected?: number | number[]
  authenticated?: boolean
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface FilesE2EContext {
  fixture: FilesE2EFixture
  sql: ReturnType<typeof postgres>
  page: Page
  baseUrl: URL
  reportDirectory: string
  cronSecret?: string
  check(name: string, run: () => Promise<void>): Promise<void>
  json(path: string, options?: FilesE2ERequestOptions): Promise<Record<string, unknown>>
}
