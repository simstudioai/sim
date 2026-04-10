import { pollingIdempotency } from '@/lib/core/idempotency/service'
import type { PollingProviderHandler, PollWebhookContext } from '@/lib/webhooks/polling/types'
import {
  markWebhookFailed,
  markWebhookSuccess,
  resolveOAuthCredential,
  updateWebhookProviderConfig,
} from '@/lib/webhooks/polling/utils'
import { processPolledWebhookEvent } from '@/lib/webhooks/processor'

const MAX_FILES_PER_POLL = 50
const MAX_KNOWN_FILE_IDS = 1000
const MAX_PAGES = 10
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'

type DriveEventTypeFilter = '' | 'created' | 'modified' | 'deleted' | 'created_or_modified'

interface GoogleDriveWebhookConfig {
  folderId?: string
  manualFolderId?: string
  mimeTypeFilter?: string
  includeSharedDrives?: boolean
  eventTypeFilter?: DriveEventTypeFilter
  maxFilesPerPoll?: number
  pageToken?: string
  knownFileIds?: string[]
}

interface DriveChangeEntry {
  kind: string
  type: string
  time: string
  removed: boolean
  fileId: string
  file?: DriveFileMetadata
}

interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  createdTime?: string
  size?: string
  webViewLink?: string
  parents?: string[]
  lastModifyingUser?: { displayName?: string; emailAddress?: string }
  shared?: boolean
  starred?: boolean
  trashed?: boolean
}

export interface GoogleDriveWebhookPayload {
  file: DriveFileMetadata | { id: string }
  eventType: 'created' | 'modified' | 'deleted'
  timestamp: string
}

const FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'modifiedTime',
  'createdTime',
  'size',
  'webViewLink',
  'parents',
  'lastModifyingUser',
  'shared',
  'starred',
  'trashed',
].join(',')

export const googleDrivePollingHandler: PollingProviderHandler = {
  provider: 'google-drive',
  label: 'Google Drive',

  async pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'> {
    const { webhookData, workflowData, requestId, logger } = ctx
    const webhookId = webhookData.id

    try {
      const accessToken = await resolveOAuthCredential(
        webhookData,
        'google-drive',
        requestId,
        logger
      )

      const config = webhookData.providerConfig as unknown as GoogleDriveWebhookConfig

      // First poll: get startPageToken and seed state
      if (!config.pageToken) {
        const startPageToken = await getStartPageToken(accessToken, config, requestId, logger)

        await updateWebhookProviderConfig(
          webhookId,
          { pageToken: startPageToken, knownFileIds: [] },
          logger
        )
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] First poll for webhook ${webhookId}, seeded pageToken: ${startPageToken}`
        )
        return 'success'
      }

      // Fetch changes since last pageToken
      const { changes, newStartPageToken } = await fetchChanges(
        accessToken,
        config,
        requestId,
        logger
      )

      if (!changes.length) {
        await updateWebhookProviderConfig(webhookId, { pageToken: newStartPageToken }, logger)
        await markWebhookSuccess(webhookId, logger)
        logger.info(`[${requestId}] No changes found for webhook ${webhookId}`)
        return 'success'
      }

      // Filter changes client-side (folder, MIME type, trashed)
      const filteredChanges = filterChanges(changes, config)

      if (!filteredChanges.length) {
        await updateWebhookProviderConfig(webhookId, { pageToken: newStartPageToken }, logger)
        await markWebhookSuccess(webhookId, logger)
        logger.info(
          `[${requestId}] ${changes.length} changes found but none match filters for webhook ${webhookId}`
        )
        return 'success'
      }

      logger.info(
        `[${requestId}] Found ${filteredChanges.length} matching changes for webhook ${webhookId}`
      )

      const { processedCount, failedCount, newKnownFileIds } = await processChanges(
        filteredChanges,
        config,
        webhookData,
        workflowData,
        requestId,
        logger
      )

      // Update state: new pageToken and rolling knownFileIds
      const existingKnownIds = config.knownFileIds || []
      const mergedKnownIds = [...new Set([...newKnownFileIds, ...existingKnownIds])].slice(
        0,
        MAX_KNOWN_FILE_IDS
      )

      const anyFailed = failedCount > 0
      await updateWebhookProviderConfig(
        webhookId,
        {
          pageToken: anyFailed ? config.pageToken : newStartPageToken,
          knownFileIds: anyFailed ? existingKnownIds : mergedKnownIds,
        },
        logger
      )

      if (failedCount > 0 && processedCount === 0) {
        await markWebhookFailed(webhookId, logger)
        logger.warn(
          `[${requestId}] All ${failedCount} changes failed to process for webhook ${webhookId}`
        )
        return 'failure'
      }

      await markWebhookSuccess(webhookId, logger)
      logger.info(
        `[${requestId}] Successfully processed ${processedCount} changes for webhook ${webhookId}${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      )
      return 'success'
    } catch (error) {
      logger.error(`[${requestId}] Error processing Google Drive webhook ${webhookId}:`, error)
      await markWebhookFailed(webhookId, logger)
      return 'failure'
    }
  },
}

async function getStartPageToken(
  accessToken: string,
  config: GoogleDriveWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<string> {
  const params = new URLSearchParams()
  if (config.includeSharedDrives) {
    params.set('supportsAllDrives', 'true')
  }

  const url = `${DRIVE_API_BASE}/changes/startPageToken?${params.toString()}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `Failed to get startPageToken: ${response.status} - ${JSON.stringify(errorData)}`
    )
  }

  const data = await response.json()
  return data.startPageToken as string
}

async function fetchChanges(
  accessToken: string,
  config: GoogleDriveWebhookConfig,
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ changes: DriveChangeEntry[]; newStartPageToken: string }> {
  const allChanges: DriveChangeEntry[] = []
  let currentPageToken = config.pageToken!
  let newStartPageToken: string | undefined
  let lastNextPageToken: string | undefined
  const maxFiles = config.maxFilesPerPoll || MAX_FILES_PER_POLL
  let pages = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pages++
    const params = new URLSearchParams({
      pageToken: currentPageToken,
      pageSize: String(Math.min(maxFiles, 100)),
      fields: `nextPageToken,newStartPageToken,changes(kind,type,time,removed,fileId,file(${FILE_FIELDS}))`,
      restrictToMyDrive: config.includeSharedDrives ? 'false' : 'true',
    })

    if (config.includeSharedDrives) {
      params.set('supportsAllDrives', 'true')
      params.set('includeItemsFromAllDrives', 'true')
    }

    const url = `${DRIVE_API_BASE}/changes?${params.toString()}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Failed to fetch changes: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const changes = (data.changes || []) as DriveChangeEntry[]
    allChanges.push(...changes)

    if (data.newStartPageToken) {
      newStartPageToken = data.newStartPageToken as string
    }

    const hasMore = !!data.nextPageToken
    const overLimit = allChanges.length >= maxFiles

    if (!hasMore || overLimit || pages >= MAX_PAGES) {
      if (hasMore) {
        lastNextPageToken = data.nextPageToken as string
      }
      break
    }

    lastNextPageToken = data.nextPageToken as string
    currentPageToken = data.nextPageToken as string
  }

  const slicingOccurs = allChanges.length > maxFiles
  const resumeToken = slicingOccurs
    ? (lastNextPageToken ?? config.pageToken!)
    : (newStartPageToken ?? lastNextPageToken ?? config.pageToken!)

  return { changes: allChanges.slice(0, maxFiles), newStartPageToken: resumeToken }
}

function filterChanges(
  changes: DriveChangeEntry[],
  config: GoogleDriveWebhookConfig
): DriveChangeEntry[] {
  return changes.filter((change) => {
    // Always include removals (deletions)
    if (change.removed) return true

    const file = change.file
    if (!file) return false

    // Exclude trashed files
    if (file.trashed) return false

    // Folder filter: check if file is in the specified folder
    const folderId = config.folderId || config.manualFolderId
    if (folderId) {
      if (!file.parents || !file.parents.includes(folderId)) {
        return false
      }
    }

    // MIME type filter
    if (config.mimeTypeFilter) {
      // Support prefix matching (e.g., "image/" matches "image/png", "image/jpeg")
      if (config.mimeTypeFilter.endsWith('/')) {
        if (!file.mimeType.startsWith(config.mimeTypeFilter)) {
          return false
        }
      } else if (file.mimeType !== config.mimeTypeFilter) {
        return false
      }
    }

    return true
  })
}

async function processChanges(
  changes: DriveChangeEntry[],
  config: GoogleDriveWebhookConfig,
  webhookData: PollWebhookContext['webhookData'],
  workflowData: PollWebhookContext['workflowData'],
  requestId: string,
  logger: ReturnType<typeof import('@sim/logger').createLogger>
): Promise<{ processedCount: number; failedCount: number; newKnownFileIds: string[] }> {
  let processedCount = 0
  let failedCount = 0
  const newKnownFileIds: string[] = []
  const knownFileIdsSet = new Set(config.knownFileIds || [])

  for (const change of changes) {
    // Determine event type before idempotency to avoid caching filter decisions
    let eventType: 'created' | 'modified' | 'deleted'
    if (change.removed) {
      eventType = 'deleted'
    } else if (!knownFileIdsSet.has(change.fileId)) {
      eventType = 'created'
    } else {
      eventType = 'modified'
    }

    // Track file as known regardless of filter (for future create/modify distinction)
    if (!change.removed) {
      newKnownFileIds.push(change.fileId)
    }

    // Client-side event type filter — skip before idempotency so filtered events aren't cached
    const filter = config.eventTypeFilter
    if (filter) {
      const skip = filter === 'created_or_modified' ? eventType === 'deleted' : eventType !== filter
      if (skip) continue
    }

    try {
      const idempotencyKey = `${webhookData.id}:${change.fileId}:${change.time || change.fileId}`

      await pollingIdempotency.executeWithIdempotency('google-drive', idempotencyKey, async () => {
        const payload: GoogleDriveWebhookPayload = {
          file: change.file || { id: change.fileId },
          eventType,
          timestamp: new Date().toISOString(),
        }

        const result = await processPolledWebhookEvent(
          webhookData,
          workflowData,
          payload,
          requestId
        )

        if (!result.success) {
          logger.error(
            `[${requestId}] Failed to process webhook for file ${change.fileId}:`,
            result.statusCode,
            result.error
          )
          throw new Error(`Webhook processing failed (${result.statusCode}): ${result.error}`)
        }

        return { fileId: change.fileId, processed: true }
      })

      logger.info(
        `[${requestId}] Successfully processed change for file ${change.fileId} for webhook ${webhookData.id}`
      )
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(
        `[${requestId}] Error processing change for file ${change.fileId}:`,
        errorMessage
      )
      failedCount++
    }
  }

  return { processedCount, failedCount, newKnownFileIds }
}
