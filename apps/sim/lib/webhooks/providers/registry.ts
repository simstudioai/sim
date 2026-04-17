import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { airtableHandler } from '@/lib/webhooks/providers/airtable'
import { ashbyHandler } from '@/lib/webhooks/providers/ashby'
import { attioHandler } from '@/lib/webhooks/providers/attio'
import { calcomHandler } from '@/lib/webhooks/providers/calcom'
import { calendlyHandler } from '@/lib/webhooks/providers/calendly'
import { circlebackHandler } from '@/lib/webhooks/providers/circleback'
import { confluenceHandler } from '@/lib/webhooks/providers/confluence'
import { fathomHandler } from '@/lib/webhooks/providers/fathom'
import { firefliesHandler } from '@/lib/webhooks/providers/fireflies'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import { githubHandler } from '@/lib/webhooks/providers/github'
import { gmailHandler } from '@/lib/webhooks/providers/gmail'
import { gongHandler } from '@/lib/webhooks/providers/gong'
import { googleFormsHandler } from '@/lib/webhooks/providers/google-forms'
import { grainHandler } from '@/lib/webhooks/providers/grain'
import { greenhouseHandler } from '@/lib/webhooks/providers/greenhouse'
import { hubspotHandler } from '@/lib/webhooks/providers/hubspot'
import { imapHandler } from '@/lib/webhooks/providers/imap'
import { intercomHandler } from '@/lib/webhooks/providers/intercom'
import { jiraHandler } from '@/lib/webhooks/providers/jira'
import { jsmHandler } from '@/lib/webhooks/providers/jsm'
import { lemlistHandler } from '@/lib/webhooks/providers/lemlist'
import { linearHandler } from '@/lib/webhooks/providers/linear'
import { microsoftTeamsHandler } from '@/lib/webhooks/providers/microsoft-teams'
import { mondayHandler } from '@/lib/webhooks/providers/monday'
import { notionHandler } from '@/lib/webhooks/providers/notion'
import { outlookHandler } from '@/lib/webhooks/providers/outlook'
import { resendHandler } from '@/lib/webhooks/providers/resend'
import { rssHandler } from '@/lib/webhooks/providers/rss'
import { salesforceHandler } from '@/lib/webhooks/providers/salesforce'
import { servicenowHandler } from '@/lib/webhooks/providers/servicenow'
import { slackHandler } from '@/lib/webhooks/providers/slack'
import { stripeHandler } from '@/lib/webhooks/providers/stripe'
import { telegramHandler } from '@/lib/webhooks/providers/telegram'
import { twilioHandler } from '@/lib/webhooks/providers/twilio'
import { twilioVoiceHandler } from '@/lib/webhooks/providers/twilio-voice'
import { typeformHandler } from '@/lib/webhooks/providers/typeform'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'
import { vercelHandler } from '@/lib/webhooks/providers/vercel'
import { webflowHandler } from '@/lib/webhooks/providers/webflow'
import { whatsappHandler } from '@/lib/webhooks/providers/whatsapp'
import { zoomHandler } from '@/lib/webhooks/providers/zoom'

const logger = createLogger('WebhookProviderRegistry')

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  airtable: airtableHandler,
  ashby: ashbyHandler,
  attio: attioHandler,
  calendly: calendlyHandler,
  calcom: calcomHandler,
  circleback: circlebackHandler,
  confluence: confluenceHandler,
  fireflies: firefliesHandler,
  generic: genericHandler,
  gmail: gmailHandler,
  github: githubHandler,
  gong: gongHandler,
  google_forms: googleFormsHandler,
  fathom: fathomHandler,
  grain: grainHandler,
  greenhouse: greenhouseHandler,
  hubspot: hubspotHandler,
  imap: imapHandler,
  intercom: intercomHandler,
  jira: jiraHandler,
  jsm: jsmHandler,
  lemlist: lemlistHandler,
  linear: linearHandler,
  monday: mondayHandler,
  resend: resendHandler,
  'microsoft-teams': microsoftTeamsHandler,
  notion: notionHandler,
  outlook: outlookHandler,
  rss: rssHandler,
  salesforce: salesforceHandler,
  servicenow: servicenowHandler,
  slack: slackHandler,
  stripe: stripeHandler,
  telegram: telegramHandler,
  twilio: twilioHandler,
  twilio_voice: twilioVoiceHandler,
  typeform: typeformHandler,
  vercel: vercelHandler,
  webflow: webflowHandler,
  whatsapp: whatsappHandler,
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
