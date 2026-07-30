import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { airtableHandler } from '@/lib/webhooks/providers/airtable'
import { ashbyHandler } from '@/lib/webhooks/providers/ashby'
import { attioHandler } from '@/lib/webhooks/providers/attio'
import { azureDevOpsHandler } from '@/lib/webhooks/providers/azure-devops'
import { calcomHandler } from '@/lib/webhooks/providers/calcom'
import { calendlyHandler } from '@/lib/webhooks/providers/calendly'
import { circlebackHandler } from '@/lib/webhooks/providers/circleback'
import { clerkHandler } from '@/lib/webhooks/providers/clerk'
import { clickupHandler } from '@/lib/webhooks/providers/clickup'
import { confluenceHandler } from '@/lib/webhooks/providers/confluence'
import { emailBisonHandler } from '@/lib/webhooks/providers/emailbison'
import { fathomHandler } from '@/lib/webhooks/providers/fathom'
import { firefliesHandler } from '@/lib/webhooks/providers/fireflies'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import { githubHandler } from '@/lib/webhooks/providers/github'
import { gitlabHandler } from '@/lib/webhooks/providers/gitlab'
import { gmailHandler } from '@/lib/webhooks/providers/gmail'
import { gongHandler } from '@/lib/webhooks/providers/gong'
import { googleFormsHandler } from '@/lib/webhooks/providers/google-forms'
import { grainHandler } from '@/lib/webhooks/providers/grain'
import { greenhouseHandler } from '@/lib/webhooks/providers/greenhouse'
import { imapHandler } from '@/lib/webhooks/providers/imap'
import { incidentioHandler } from '@/lib/webhooks/providers/incidentio'
import { instantlyHandler } from '@/lib/webhooks/providers/instantly'
import { intercomHandler } from '@/lib/webhooks/providers/intercom'
import { jiraHandler } from '@/lib/webhooks/providers/jira'
import { jsmHandler } from '@/lib/webhooks/providers/jsm'
import { lemlistHandler } from '@/lib/webhooks/providers/lemlist'
import { linearHandler } from '@/lib/webhooks/providers/linear'
import { linqHandler } from '@/lib/webhooks/providers/linq'
import { loopsHandler } from '@/lib/webhooks/providers/loops'
import { microsoftTeamsHandler } from '@/lib/webhooks/providers/microsoft-teams'
import { mondayHandler } from '@/lib/webhooks/providers/monday'
import { notionHandler } from '@/lib/webhooks/providers/notion'
import { outlookHandler } from '@/lib/webhooks/providers/outlook'
import { pagerdutyHandler } from '@/lib/webhooks/providers/pagerduty'
import { resendHandler } from '@/lib/webhooks/providers/resend'
import { revenueCatHandler } from '@/lib/webhooks/providers/revenuecat'
import { rootlyHandler } from '@/lib/webhooks/providers/rootly'
import { rssHandler } from '@/lib/webhooks/providers/rss'
import { salesforceHandler } from '@/lib/webhooks/providers/salesforce'
import { sendblueHandler } from '@/lib/webhooks/providers/sendblue'
import { sentryHandler } from '@/lib/webhooks/providers/sentry'
import { servicenowHandler } from '@/lib/webhooks/providers/servicenow'
import { slackHandler } from '@/lib/webhooks/providers/slack'
import { stripeHandler } from '@/lib/webhooks/providers/stripe'
import { tableProviderHandler } from '@/lib/webhooks/providers/table'
import { telegramHandler } from '@/lib/webhooks/providers/telegram'
import { tiktokHandler } from '@/lib/webhooks/providers/tiktok'
import { twilioHandler } from '@/lib/webhooks/providers/twilio'
import { twilioVoiceHandler } from '@/lib/webhooks/providers/twilio-voice'
import { typeformHandler } from '@/lib/webhooks/providers/typeform'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'
import { vercelHandler } from '@/lib/webhooks/providers/vercel'
import { webflowHandler } from '@/lib/webhooks/providers/webflow'
import { whatsappHandler } from '@/lib/webhooks/providers/whatsapp'
import { zendeskHandler } from '@/lib/webhooks/providers/zendesk'
import { zoomHandler } from '@/lib/webhooks/providers/zoom'

const logger = createLogger('WebhookProviderRegistry')

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  airtable: airtableHandler,
  ashby: ashbyHandler,
  attio: attioHandler,
  azure_devops: azureDevOpsHandler,
  calendly: calendlyHandler,
  calcom: calcomHandler,
  circleback: circlebackHandler,
  clerk: clerkHandler,
  clickup: clickupHandler,
  confluence: confluenceHandler,
  emailbison: emailBisonHandler,
  fireflies: firefliesHandler,
  generic: genericHandler,
  gmail: gmailHandler,
  github: githubHandler,
  gitlab: gitlabHandler,
  gong: gongHandler,
  google_forms: googleFormsHandler,
  fathom: fathomHandler,
  grain: grainHandler,
  greenhouse: greenhouseHandler,
  imap: imapHandler,
  incidentio: incidentioHandler,
  intercom: intercomHandler,
  instantly: instantlyHandler,
  jira: jiraHandler,
  jsm: jsmHandler,
  lemlist: lemlistHandler,
  linear: linearHandler,
  linq: linqHandler,
  loops: loopsHandler,
  monday: mondayHandler,
  resend: resendHandler,
  revenuecat: revenueCatHandler,
  rootly: rootlyHandler,
  sentry: sentryHandler,
  'microsoft-teams': microsoftTeamsHandler,
  notion: notionHandler,
  outlook: outlookHandler,
  pagerduty: pagerdutyHandler,
  rss: rssHandler,
  salesforce: salesforceHandler,
  sendblue: sendblueHandler,
  servicenow: servicenowHandler,
  slack: slackHandler,
  // Native OAuth Slack trigger — inbound events are verified in the shared
  // /api/webhooks/slack route; the handler reuses Slack payload normalization.
  slack_app: slackHandler,
  stripe: stripeHandler,
  table: tableProviderHandler,
  telegram: telegramHandler,
  tiktok: tiktokHandler,
  twilio: twilioHandler,
  twilio_voice: twilioVoiceHandler,
  typeform: typeformHandler,
  vercel: vercelHandler,
  webflow: webflowHandler,
  whatsapp: whatsappHandler,
  zendesk: zendeskHandler,
  zoom: zoomHandler,
}

/**
 * Default handler for unknown/future providers.
 * Uses timing-safe comparison for bearer token validation.
 */
const defaultHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }) {
    const token = providerConfig.token
    if (typeof token === 'string') {
      if (!verifyTokenAuth(request, token)) {
        logger.warn(`[${requestId}] Unauthorized webhook access attempt - invalid token`)
        return new NextResponse('Unauthorized', { status: 401 })
      }
    }
    return null
  },
}

/** Look up the provider handler, falling back to the default bearer token handler. */
export function getProviderHandler(provider: string): WebhookProviderHandler {
  return PROVIDER_HANDLERS[provider] ?? defaultHandler
}
