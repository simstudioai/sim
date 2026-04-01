'use client'

import type { ComponentType, SVGProps } from 'react'
import { memo, useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AirtableIcon,
  AmplitudeIcon,
  ApolloIcon,
  AsanaIcon,
  CalendlyIcon,
  ConfluenceIcon,
  DatadogIcon,
  DiscordIcon,
  FirecrawlIcon,
  GithubIcon,
  GmailIcon,
  GongIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  GreenhouseIcon,
  HubspotIcon,
  IntercomIcon,
  JiraIcon,
  LemlistIcon,
  LinearIcon,
  LinkedInIcon,
  MailchimpIcon,
  MicrosoftTeamsIcon,
  NotionIcon,
  ObsidianIcon,
  PagerDutyIcon,
  RedditIcon,
  SalesforceIcon,
  SentryIcon,
  ShopifyIcon,
  SlackIcon,
  StripeIcon,
  TwilioIcon,
  TypeformIcon,
  WebflowIcon,
  WordpressIcon,
  xIcon,
  YouTubeIcon,
  ZendeskIcon,
} from '@/components/icons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const INTEGRATION_BLOCK_ICONS: Record<string, IconComponent> = {
  airtable: AirtableIcon,
  amplitude: AmplitudeIcon,
  apollo: ApolloIcon,
  asana: AsanaIcon,
  calendly: CalendlyIcon,
  confluence: ConfluenceIcon,
  datadog: DatadogIcon,
  discord: DiscordIcon,
  firecrawl: FirecrawlIcon,
  github: GithubIcon,
  gmail: GmailIcon,
  gong: GongIcon,
  google_calendar: GoogleCalendarIcon,
  google_docs: GoogleDocsIcon,
  google_drive: GoogleDriveIcon,
  google_sheets: GoogleSheetsIcon,
  greenhouse: GreenhouseIcon,
  hubspot: HubspotIcon,
  intercom: IntercomIcon,
  jira: JiraIcon,
  lemlist: LemlistIcon,
  linear: LinearIcon,
  linkedin: LinkedInIcon,
  mailchimp: MailchimpIcon,
  microsoft_teams: MicrosoftTeamsIcon,
  notion: NotionIcon,
  obsidian: ObsidianIcon,
  pagerduty: PagerDutyIcon,
  reddit: RedditIcon,
  salesforce: SalesforceIcon,
  sentry: SentryIcon,
  shopify: ShopifyIcon,
  slack: SlackIcon,
  stripe: StripeIcon,
  twilio_sms: TwilioIcon,
  typeform: TypeformIcon,
  webflow: WebflowIcon,
  wordpress: WordpressIcon,
  x: xIcon,
  youtube: YouTubeIcon,
  zendesk: ZendeskIcon,
} as const

interface IntegrationIconStackProps {
  blockTypes: string[]
}

export const IntegrationIconStack = memo(function IntegrationIconStack({
  blockTypes,
}: IntegrationIconStackProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const shouldReduceMotion = useReducedMotion()

  const icons = blockTypes
    .map((type) => ({ type, Icon: INTEGRATION_BLOCK_ICONS[type] }))
    .filter((entry): entry is { type: string; Icon: IconComponent } => entry.Icon != null)

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null)
  }, [])

  if (icons.length === 0) return null

  const getScale = (index: number) => {
    if (hoveredIndex === null || shouldReduceMotion) return 1
    const distance = Math.abs(index - hoveredIndex)
    if (distance === 0) return 1.05
    if (distance === 1) return 1.02
    return 1
  }

  return (
    <div className='ml-auto flex shrink-0 items-end' onMouseLeave={handleMouseLeave}>
      {icons.map(({ type, Icon }, index) => (
        <motion.div
          key={type}
          onMouseEnter={() => setHoveredIndex(index)}
          animate={{
            transform: `scale(${getScale(index)})`,
          }}
          transition={{ type: 'spring', bounce: 0.15, duration: 0.25 }}
          style={{ zIndex: hoveredIndex === index ? 50 : icons.length - index }}
          className='-ml-1 flex h-5 w-5 origin-bottom items-center justify-center rounded-full border border-[var(--border-1)] bg-[var(--white)] first:ml-0 dark:bg-[var(--surface-4)]'
        >
          <Icon aria-hidden='true' className='h-3 w-3' />
        </motion.div>
      ))}
    </div>
  )
})
