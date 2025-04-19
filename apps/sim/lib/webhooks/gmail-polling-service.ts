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
  maxEmailsPerPoll: number
  pollingInterval: number
  lastCheckedTimestamp?: string
  historyId?: string
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
          
          // Check if it's time to poll this webhook
          const now = new Date()
          const lastChecked = config.lastCheckedTimestamp 
            ? new Date(config.lastCheckedTimestamp) 
            : new Date(0)
          
          const minutesSinceLastCheck = (now.getTime() - lastChecked.getTime()) / (1000 * 60)
          
          if (minutesSinceLastCheck < config.pollingInterval) {
            logger.debug(`[${requestId}] Skipping webhook ${webhookId}, not due for polling yet`)
            return { success: true, webhookId, status: 'skipped' }
          }
          
          // Fetch new emails
          const emails = await fetchNewEmails(
            accessToken, 
            config, 
            requestId
          )
          
          if (!emails || !emails.length) {
            // Update last checked timestamp
            await updateWebhookLastChecked(webhookId, now.toISOString(), config.historyId)
            logger.info(`[${requestId}] No new emails found for webhook ${webhookId}`)
            return { success: true, webhookId, status: 'no_emails' }
          }
          
          logger.info(`[${requestId}] Found ${emails.length} new emails for webhook ${webhookId}`)
          
          // Process emails
          const processed = await processEmails(
            emails,
            webhookData,
            config,
            accessToken,
            requestId
          )
          
          // Update webhook with latest history ID and timestamp
          const latestHistoryId = emails[0].historyId
          await updateWebhookLastChecked(webhookId, now.toISOString(), latestHistoryId)
          
          return { 
            success: true, 
            webhookId, 
            emailsFound: emails.length,
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
        return await searchEmails(accessToken, config, requestId)
      }
      
      const historyData = await historyResponse.json()
      
      if (!historyData.history || !historyData.history.length) {
        return []
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
      
      // Fetch full email details for each message
      emails = await Promise.all(
        [...messageIds].slice(0, config.maxEmailsPerPoll).map(async (messageId) => {
          return await getEmailDetails(accessToken, messageId)
        })
      )
      
      // Filter emails by labels if needed
      emails = filterEmailsByLabels(emails, config)
    } else {
      // Use search if no history ID is available
      emails = await searchEmails(accessToken, config, requestId)
    }
    
    return emails
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error fetching new emails:`, errorMessage)
    return []
  }
}

async function searchEmails(
  accessToken: string,
  config: GmailWebhookConfig,
  requestId: string
) {
  try {
    // Build query parameters for label filtering
    const labelQuery = config.labelIds
      .map(label => `label:${label}`)
      .join(' ')
    
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
      return []
    }
    
    const searchData = await searchResponse.json()
    
    if (!searchData.messages || !searchData.messages.length) {
      return []
    }
    
    // Fetch full email details for each message
    const emails = await Promise.all(
      searchData.messages.map(async (message: { id: string }) => {
        return await getEmailDetails(accessToken, message.id)
      })
    )
    
    return emails
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Error searching emails:`, errorMessage)
    return []
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