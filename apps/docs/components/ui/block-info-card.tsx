'use client'

import type * as React from 'react'
import * as Icons from '@/components/icons'

// Map block types to their icon component names
const blockTypeToIconMap: Record<string, keyof typeof Icons> = {
  trello: 'TrelloIcon',
  stripe: 'StripeIcon',
  slack: 'SlackIcon',
  gmail: 'GmailIcon',
  google_sheets: 'GoogleSheetsIcon',
  google_docs: 'GoogleDocsIcon',
  google_drive: 'GoogleDriveIcon',
  google_calendar: 'GoogleCalendarIcon',
  google_forms: 'GoogleFormsIcon',
  google_vault: 'GoogleVaultIcon',
  notion: 'NotionIcon',
  airtable: 'AirtableIcon',
  discord: 'DiscordIcon',
  github: 'GithubIcon',
  linkedin: 'LinkedInIcon',
  twitter: 'xIcon',
  x: 'xIcon',
  telegram: 'TelegramIcon',
  whatsapp: 'WhatsAppIcon',
  reddit: 'RedditIcon',
  youtube: 'YouTubeIcon',
  hubspot: 'HubspotIcon',
  salesforce: 'SalesforceIcon',
  pipedrive: 'PipedriveIcon',
  microsoft_teams: 'MicrosoftTeamsIcon',
  microsoft_excel: 'MicrosoftExcelIcon',
  microsoft_onedrive: 'MicrosoftOneDriveIcon',
  microsoft_sharepoint: 'MicrosoftSharepointIcon',
  microsoft_planner: 'MicrosoftPlannerIcon',
  outlook: 'OutlookIcon',
  confluence: 'ConfluenceIcon',
  jira: 'JiraIcon',
  linear: 'LinearIcon',
  asana: 'AsanaIcon',
  crunchbase: 'CrunchbaseIcon',
  typeform: 'TypeformIcon',
  stagehand: 'StagehandIcon',
  stagehand_agent: 'StagehandIcon',
  browser_use: 'BrowserUseIcon',
  firecrawl: 'FirecrawlIcon',
  serper: 'SerperIcon',
  tavily: 'TavilyIcon',
  perplexity: 'PerplexityIcon',
  exa: 'ExaAIIcon',
  linkup: 'LinkupIcon',
  jina: 'JinaAIIcon',
  arxiv: 'ArxivIcon',
  wikipedia: 'WikipediaIcon',
  hunter_io: 'HunterIOIcon',
  twilio: 'TwilioIcon',
  openai: 'OpenAIIcon',
  anthropic: 'AnthropicIcon',
  xai: 'xAIIcon',
  groq: 'GroqIcon',
  cerebras: 'CerebrasIcon',
  azure: 'AzureIcon',
  mistral: 'MistralIcon',
  mistral_parse: 'MistralIcon',
  gemini: 'GeminiIcon',
  deepseek: 'DeepseekIcon',
  ollama: 'OllamaIcon',
  openrouter: 'OpenRouterIcon',
  pinecone: 'PineconeIcon',
  qdrant: 'QdrantIcon',
  zep: 'ZepIcon',
  mem0: 'Mem0Icon',
  supabase: 'SupabaseIcon',
  postgres: 'PostgresIcon',
  mysql: 'MySQLIcon',
  mongodb: 'MongoDBIcon',
  s3: 'S3Icon',
  resend: 'ResendIcon',
  elevenlabs: 'ElevenLabsIcon',
  crewai: 'CrewAIIcon',
  clay: 'ClayIcon',
  wealthbox: 'WealthboxIcon',
  webflow: 'WebflowIcon',
}

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: React.ComponentType<{ className?: string }>
  iconSvg?: string // Deprecated: Use automatic icon resolution instead
}

export function BlockInfoCard({
  type,
  color,
  icon: IconComponent,
  iconSvg,
}: BlockInfoCardProps): React.ReactNode {
  // Auto-resolve icon component from block type if not explicitly provided
  const ResolvedIcon =
    IconComponent || (blockTypeToIconMap[type] ? Icons[blockTypeToIconMap[type]] : null)

  return (
    <div className='mb-6 overflow-hidden rounded-lg border border-border'>
      <div className='flex items-center justify-center p-6'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-lg'
          style={{ backgroundColor: color }}
        >
          {ResolvedIcon ? (
            <ResolvedIcon className='h-10 w-10 text-white' />
          ) : iconSvg ? (
            <div className='h-10 w-10 text-white' dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className='font-mono text-xl opacity-70'>{type.substring(0, 2)}</div>
          )}
        </div>
      </div>
    </div>
  )
}
