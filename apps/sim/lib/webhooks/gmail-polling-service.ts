import { Logger } from '@/lib/logs/console-logger'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { webhook } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

const logger = new Logger('GmailPollingService')

interface GmailWebhookConfig {
  labelIds: string[]
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  processIncomingEmails: boolean
  markAsRead: boolean
  maxEmailsPerPoll?: number
  singleEmailMode: boolean
  lastCheckedTimestamp?: string
  historyId?: string
  processedEmailIds?: string[]
}

export async function pollGmailWebhooks() {
  logger.info('Starting Gmail webhook polling')
  
  try {
    // Get all active Gmail webhooks
    const activeWebhooks = await db
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.provider, 'gmail'),
          eq(webhook.isActive, true)
        )
      )
    
    if (!activeWebhooks.length) {
      logger.info('No active Gmail webhooks found')
      return
    }
    
    logger.info(`Found ${activeWebhooks.length} active Gmail webhooks`)
    
    // Process each webhook
    const pollResults = await Promise.allSettled(
      activeWebhooks.map(async webhookData => {
        const webhookId = webhookData.id
        const requestId = nanoid()
        
        try {
          // Extract user ID from webhook metadata if available
          const metadata = webhookData.providerConfig as any
          const userId = metadata?.userId
          
          if (!userId) {
            logger.error(`[${requestId}] No user ID found for webhook ${webhookId}`)
            return { success: false, webhookId, error: 'No user ID' }
          }
          
          // Get OAuth token for Gmail API
          const accessToken = await getOAuthToken(userId, 'google-email')
          
          if (!accessToken) {
            logger.error(`[${requestId}] Failed to get Gmail access token for webhook ${webhookId}`)
            return { success: false, webhookId, error: 'No access token' }
          }
          
          // Get webhook configuration
          const config = webhookData.providerConfig as unknown as GmailWebhookConfig
          
          if (!config || !config.processIncomingEmails) {
            logger.info(`[${requestId}] Webhook ${webhookId} is not configured to process incoming emails`)
            return { success: false, webhookId, error: 'Not configured to process emails' }
          }
          
          // Remove the polling interval check since we're controlling execution frequency via CRON
          // We always want to check for new emails every time this function is called
          
          const now = new Date()
          
          // Fetch new emails
          const fetchResult = await fetchNewEmails(
            accessToken, 
            config, 
            requestId
          )
          
          const { emails, latestHistoryId } = fetchResult
          
          if (!emails || !emails.length) {
            // Update last checked timestamp
            await updateWebhookLastChecked(webhookId, now.toISOString(), latestHistoryId || config.historyId)
            logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
            return { success: true, webhookId, status: 'no_emails' }
          }
          
          logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)
          
          // Get processed email IDs (to avoid duplicates)
          const processedEmailIds = config.processedEmailIds || []
          
          // Filter out emails that have already been processed
          const newEmails = emails.filter(email => !processedEmailIds.includes(email.id))
          
          if (newEmails.length === 0) {
            logger.info(`[${requestId}] All emails have already been processed for webhook ${webhookId}`)
            await updateWebhookLastChecked(webhookId, now.toISOString(), latestHistoryId || config.historyId)
            return { success: true, webhookId, status: 'already_processed' }
          }
          
          logger.info(`[${requestId}] Processing ${newEmails.length} new emails for webhook ${webhookId}`)
          
          // If configured to only process the most recent email (simulating webhook behavior)
          // and there are multiple new emails, just take the most recent one
          const emailsToProcess = config.singleEmailMode === true && newEmails.length > 1
            ? [newEmails[0]] // Gmail returns emails in reverse chronological order
            : newEmails
          
          // Process emails
          const processed = await processEmails(
            emailsToProcess,
            webhookData,
            config,
            accessToken,
            requestId
          )
          
          // Record which email IDs have been processed
          const newProcessedIds = [...processedEmailIds, ...emailsToProcess.map(email => email.id)]
          // Keep only the most recent 100 IDs to prevent the list from growing too large
          const trimmedProcessedIds = newProcessedIds.slice(-100)
          
          // Update webhook with latest history ID, timestamp, and processed email IDs
          await updateWebhookData(
            webhookId, 
            now.toISOString(), 
            latestHistoryId || config.historyId,
            trimmedProcessedIds
          )
          
          return { 
            success: true, 
            webhookId, 
            emailsFound: emails.length,
            newEmails: newEmails.length,
            emailsProcessed: processed 
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          logger.error(`[${requestId}] Error processing Gmail webhook ${webhookId}:`, error)
          return { success: false, webhookId, error: errorMessage }
        }
      })
    )
    
    const results = {
      total: pollResults.length,
      successful: pollResults.filter(r => r.status === 'fulfilled' && r.value.success).length,
      failed: pollResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length,
      details: pollResults.map(r => 
        r.status === 'fulfilled' 
          ? r.value 
          : { success: false, error: r.reason }
      )
    }
    
    logger.info('Gmail polling completed', { results })
    
    return results
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error in Gmail polling service:', errorMessage)
    throw error
  }
}

async function fetchNewEmails(
  accessToken: string,
  config: GmailWebhookConfig,
  requestId: string
) {
  try {
    // Determine whether to use history API or search
    const useHistoryApi = !!config.historyId
    let emails = []
    let latestHistoryId = config.historyId
    
    if (useHistoryApi) {
      // Use history API to get changes since last check
      const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${config.historyId}`
      
      const historyResponse = await fetch(historyUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      
      if (!historyResponse.ok) {
        const errorData = await historyResponse.json()
        logger.error(`[${requestId}] Gmail history API error:`, {
          status: historyResponse.status,
          statusText: historyResponse.statusText,
          error: errorData
        })
        
        // Fall back to search if history API fails
        logger.info(`[${requestId}] Falling back to search API after history API failure`)
        const searchResult = await searchEmails(accessToken, config, requestId)
        return { 
          emails: searchResult.emails,
          latestHistoryId: searchResult.latestHistoryId
        }
      }
      
      const historyData = await historyResponse.json()
      
      if (!historyData.history || !historyData.history.length) {
        return { emails: [], latestHistoryId }
      }
      
      // Update the latest history ID
      if (historyData.historyId) {
        latestHistoryId = historyData.historyId
      }
      
      // Extract message IDs from history
      const messageIds = new Set<string>()
      
      for (const history of historyData.history) {
        if (history.messagesAdded) {
          for (const messageAdded of history.messagesAdded) {
            messageIds.add(messageAdded.message.id)
          }
        }
      }
      
      if (messageIds.size === 0) {
        return { emails: [], latestHistoryId }
      }
      
      // Sort IDs by recency (reverse order)
      const sortedIds = [...messageIds].sort().reverse()
      
      // Determine which message IDs to fetch based on configuration
      let idsToFetch = sortedIds
      
      // If we only want to process the most recent email (simulating a webhook)
      if (config.singleEmailMode === true && sortedIds.length > 0) {
        // Just take the most recent email if we want to simulate webhook behavior
        idsToFetch = [sortedIds[0]]
        logger.info(`[${requestId}] Processing only the most recent email ${sortedIds[0]} to simulate webhook behavior`)
      } else {
        // Otherwise, limit by max emails per poll
        idsToFetch = sortedIds.slice(0, config.maxEmailsPerPoll || 100)
      }
      
      // Fetch full email details for each message
      emails = await Promise.all(
        idsToFetch.map(async (messageId) => {
          return await getEmailDetails(accessToken, messageId)
        })
      )
      
      // Filter emails by labels if needed
      emails = filterEmailsByLabels(emails, config)
    } else {
      // Use search if no history ID is available
      const searchResult = await searchEmails(accessToken, config, requestId)
      return searchResult
    }
    
    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

async function searchEmails(
  accessToken: string,
  config: GmailWebhookConfig,
  requestId: string
) {
  try {
    // Build query parameters for label filtering
    const labelQuery = config.labelIds && config.labelIds.length > 0
      ? config.labelIds.map(label => `label:${label}`).join(' ')
      : 'in:inbox'
    
    // Combine with is:unread or custom query if needed
    const query = config.labelFilterBehavior === 'INCLUDE'
      ? labelQuery
      : `-${labelQuery}`
    
    // Search for emails
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${config.maxEmailsPerPoll}`
    
    const searchResponse = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    
    if (!searchResponse.ok) {
      const errorData = await searchResponse.json()
      logger.error(`[${requestId}] Gmail search API error:`, {
        status: searchResponse.status,
        statusText: searchResponse.statusText,
        query: query,
        error: errorData
      })
      return { emails: [], latestHistoryId: config.historyId }
    }
    
    const searchData = await searchResponse.json()
    
    if (!searchData.messages || !searchData.messages.length) {
      return { emails: [], latestHistoryId: config.historyId }
    }
    
    let idsToFetch = searchData.messages
    let latestHistoryId = config.historyId
    
    // If we only want to process the most recent email (simulating a webhook)
    if (config.singleEmailMode === true && searchData.messages.length > 0) {
      // Gmail returns them in reverse chronological order, so the first one is the newest
      idsToFetch = [searchData.messages[0]]
      logger.info(`[${requestId}] Processing only the most recent email ${idsToFetch[0].id} to simulate webhook behavior`)
    } else {
      // Otherwise, respect the configured limit
      idsToFetch = searchData.messages.slice(0, config.maxEmailsPerPoll || 100)
    }
    
    // Fetch full email details for each message
    const emails = await Promise.all(
      idsToFetch.map(async (message: { id: string }) => {
        return await getEmailDetails(accessToken, message.id)
      })
    )
    
    // Get the latest history ID from the first email (most recent)
    if (emails.length > 0 && emails[0].historyId) {
      latestHistoryId = emails[0].historyId
    }
    
    return { emails, latestHistoryId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error searching emails:`, errorMessage)
    return { emails: [], latestHistoryId: config.historyId }
  }
}

async function getEmailDetails(accessToken: string, messageId: string) {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`
  
  const messageResponse = await fetch(messageUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  
  if (!messageResponse.ok) {
    const errorData = await messageResponse.json().catch(() => ({}))
    throw new Error(`Failed to fetch email details for message ${messageId}: ${messageResponse.status} ${messageResponse.statusText} - ${JSON.stringify(errorData)}`)
  }
  
  return await messageResponse.json()
}

function filterEmailsByLabels(emails: any[], config: GmailWebhookConfig) {
  if (!config.labelIds.length) {
    return emails
  }
  
  return emails.filter(email => {
    const emailLabels = email.labelIds || []
    const hasMatchingLabel = config.labelIds.some(configLabel => 
      emailLabels.includes(configLabel)
    )
    
    return config.labelFilterBehavior === 'INCLUDE'
      ? hasMatchingLabel  // Include emails with matching labels
      : !hasMatchingLabel // Exclude emails with matching labels
  })
}

async function processEmails(
  emails: any[],
  webhookData: any,
  config: GmailWebhookConfig,
  accessToken: string,
  requestId: string
) {
  let processedCount = 0
  
  for (const email of emails) {
    try {
      // Prepare webhook payload
      const payload = {
        email,
        timestamp: new Date().toISOString()
      }
      
      // Trigger the webhook
      const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/trigger/${webhookData.path}`
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookData.secret || '',
        },
        body: JSON.stringify(payload),
      })
      
      if (!response.ok) {
        logger.error(`[${requestId}] Failed to trigger webhook for email ${email.id}:`, 
          response.status, await response.text())
        continue
      }
      
      // Mark email as read if configured
      if (config.markAsRead) {
        await markEmailAsRead(accessToken, email.id)
      }
      
      processedCount++
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[${requestId}] Error processing email ${email.id}:`, errorMessage)
    }
  }
  
  return processedCount
}

async function markEmailAsRead(accessToken: string, messageId: string) {
  const modifyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`
  
  await fetch(modifyUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: ['UNREAD'],
    }),
  })
}

async function updateWebhookLastChecked(webhookId: string, timestamp: string, historyId?: string) {
  const existingConfig = (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {};
  await db.update(webhook).set({
    providerConfig: {
      ...existingConfig,
      lastCheckedTimestamp: timestamp,
      ...(historyId ? { historyId } : {}),
    },
    updatedAt: new Date(),
  }).where(eq(webhook.id, webhookId))
}

async function updateWebhookData(
  webhookId: string, 
  timestamp: string, 
  historyId?: string,
  processedEmailIds?: string[]
) {
  const existingConfig = (await db.select().from(webhook).where(eq(webhook.id, webhookId)))[0]?.providerConfig || {};
  
  await db.update(webhook).set({
    providerConfig: {
      ...existingConfig,
      lastCheckedTimestamp: timestamp,
      ...(historyId ? { historyId } : {}),
      ...(processedEmailIds ? { processedEmailIds } : {}),
    },
    updatedAt: new Date(),
  }).where(eq(webhook.id, webhookId))
} 