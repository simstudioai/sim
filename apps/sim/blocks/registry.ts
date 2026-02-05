import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { AhrefsBlock } from '@/blocks/blocks/ahrefs'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { AirweaveBlock } from '@/blocks/blocks/airweave'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { AsanaBlock } from '@/blocks/blocks/asana'
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { CalComBlock } from '@/blocks/blocks/calcom'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock } from '@/blocks/blocks/circleback'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ClerkBlock } from '@/blocks/blocks/clerk'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock, ConfluenceV2Block } from '@/blocks/blocks/confluence'
import { CursorBlock, CursorV2Block } from '@/blocks/blocks/cursor'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { DropboxBlock } from '@/blocks/blocks/dropbox'
import { DSPyBlock } from '@/blocks/blocks/dspy'
import { DuckDuckGoBlock } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EnrichBlock } from '@/blocks/blocks/enrich'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock } from '@/blocks/blocks/exa'
import { FileBlock, FileV2Block, FileV3Block } from '@/blocks/blocks/file'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FirefliesBlock, FirefliesV2Block } from '@/blocks/blocks/fireflies'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GitHubBlock, GitHubV2Block } from '@/blocks/blocks/github'
import { GitLabBlock } from '@/blocks/blocks/gitlab'
import { GmailBlock, GmailV2Block } from '@/blocks/blocks/gmail'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleCalendarBlock, GoogleCalendarV2Block } from '@/blocks/blocks/google_calendar'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock } from '@/blocks/blocks/google_forms'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'
import { GoogleMapsBlock } from '@/blocks/blocks/google_maps'
import { GoogleSheetsBlock, GoogleSheetsV2Block } from '@/blocks/blocks/google_sheets'
import { GoogleSlidesBlock, GoogleSlidesV2Block } from '@/blocks/blocks/google_slides'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import { GrafanaBlock } from '@/blocks/blocks/grafana'
import { GrainBlock } from '@/blocks/blocks/grain'
import { GreptileBlock } from '@/blocks/blocks/greptile'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HubSpotBlock } from '@/blocks/blocks/hubspot'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { HunterBlock } from '@/blocks/blocks/hunter'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { ImapBlock } from '@/blocks/blocks/imap'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { IntercomBlock, IntercomV2Block } from '@/blocks/blocks/intercom'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import { KalshiBlock, KalshiV2Block } from '@/blocks/blocks/kalshi'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LangsmithBlock } from '@/blocks/blocks/langsmith'
import { LemlistBlock } from '@/blocks/blocks/lemlist'
import { LinearBlock } from '@/blocks/blocks/linear'
import { LinkedInBlock } from '@/blocks/blocks/linkedin'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { MailgunBlock } from '@/blocks/blocks/mailgun'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftExcelBlock, MicrosoftExcelV2Block } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import {
  MistralParseBlock,
  MistralParseV2Block,
  MistralParseV3Block,
} from '@/blocks/blocks/mistral_parse'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { MySQLBlock } from '@/blocks/blocks/mysql'
import { Neo4jBlock } from '@/blocks/blocks/neo4j'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotionBlock, NotionV2Block } from '@/blocks/blocks/notion'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import { OpenAIBlock } from '@/blocks/blocks/openai'
import { OutlookBlock } from '@/blocks/blocks/outlook'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import { PineconeBlock } from '@/blocks/blocks/pinecone'
import { PipedriveBlock } from '@/blocks/blocks/pipedrive'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { PostgreSQLBlock } from '@/blocks/blocks/postgresql'
import { PostHogBlock } from '@/blocks/blocks/posthog'
import { PulseBlock, PulseV2Block } from '@/blocks/blocks/pulse'
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { RDSBlock } from '@/blocks/blocks/rds'
import { RedditBlock } from '@/blocks/blocks/reddit'
import { ReductoBlock, ReductoV2Block } from '@/blocks/blocks/reducto'
import { ResendBlock } from '@/blocks/blocks/resend'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock } from '@/blocks/blocks/rss'
import { S3Block } from '@/blocks/blocks/s3'
import { SalesforceBlock } from '@/blocks/blocks/salesforce'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SendGridBlock } from '@/blocks/blocks/sendgrid'
import { SentryBlock } from '@/blocks/blocks/sentry'
import { SerperBlock } from '@/blocks/blocks/serper'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { SftpBlock } from '@/blocks/blocks/sftp'
import { SharepointBlock } from '@/blocks/blocks/sharepoint'
import { ShopifyBlock } from '@/blocks/blocks/shopify'
import { SimilarwebBlock } from '@/blocks/blocks/similarweb'
import { SlackBlock } from '@/blocks/blocks/slack'
import { SmtpBlock } from '@/blocks/blocks/smtp'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import { SQSBlock } from '@/blocks/blocks/sqs'
import { SSHBlock } from '@/blocks/blocks/ssh'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { SttBlock, SttV2Block } from '@/blocks/blocks/stt'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { TextractBlock, TextractV2Block } from '@/blocks/blocks/textract'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TinybirdBlock } from '@/blocks/blocks/tinybird'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock } from '@/blocks/blocks/trello'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VideoGeneratorBlock, VideoGeneratorV2Block } from '@/blocks/blocks/video_generator'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { WebflowBlock } from '@/blocks/blocks/webflow'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock } from '@/blocks/blocks/wikipedia'
import { WordPressBlock } from '@/blocks/blocks/wordpress'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { XBlock } from '@/blocks/blocks/x'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import { ZendeskBlock } from '@/blocks/blocks/zendesk'
import { ZepBlock } from '@/blocks/blocks/zep'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import type { BlockConfig } from '@/blocks/types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  a2a: A2ABlock,
  agent: AgentBlock,
  ahrefs: AhrefsBlock,
  airtable: AirtableBlock,
  airweave: AirweaveBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  apify: ApifyBlock,
  apollo: ApolloBlock,
  arxiv: ArxivBlock,
  asana: AsanaBlock,
  browser_use: BrowserUseBlock,
  calcom: CalComBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  clay: ClayBlock,
  clerk: ClerkBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  confluence_v2: ConfluenceV2Block,
  cursor: CursorBlock,
  cursor_v2: CursorV2Block,
  datadog: DatadogBlock,
  discord: DiscordBlock,
  dropbox: DropboxBlock,
  dspy: DSPyBlock,
  duckduckgo: DuckDuckGoBlock,
  dynamodb: DynamoDBBlock,
  elasticsearch: ElasticsearchBlock,
  elevenlabs: ElevenLabsBlock,
  enrich: EnrichBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  firecrawl: FirecrawlBlock,
  fireflies: FirefliesBlock,
  fireflies_v2: FirefliesV2Block,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  github: GitHubBlock,
  github_v2: GitHubV2Block,
  gitlab: GitLabBlock,
  gmail: GmailBlock,
  gmail_v2: GmailV2Block,
  google_calendar: GoogleCalendarBlock,
  google_calendar_v2: GoogleCalendarV2Block,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_groups: GoogleGroupsBlock,
  google_maps: GoogleMapsBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  google_sheets_v2: GoogleSheetsV2Block,
  google_slides: GoogleSlidesBlock,
  google_slides_v2: GoogleSlidesV2Block,
  google_vault: GoogleVaultBlock,
  grafana: GrafanaBlock,
  grain: GrainBlock,
  greptile: GreptileBlock,
  guardrails: GuardrailsBlock,
  hubspot: HubSpotBlock,
  huggingface: HuggingFaceBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  hunter: HunterBlock,
  image_generator: ImageGeneratorBlock,
  imap: ImapBlock,
  incidentio: IncidentioBlock,
  input_trigger: InputTriggerBlock,
  intercom: IntercomBlock,
  intercom_v2: IntercomV2Block,
  jina: JinaBlock,
  jira: JiraBlock,
  jira_service_management: JiraServiceManagementBlock,
  kalshi: KalshiBlock,
  kalshi_v2: KalshiV2Block,
  knowledge: KnowledgeBlock,
  langsmith: LangsmithBlock,
  lemlist: LemlistBlock,
  linear: LinearBlock,
  linkedin: LinkedInBlock,
  linkup: LinkupBlock,
  mailchimp: MailchimpBlock,
  mailgun: MailgunBlock,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  mem0: Mem0Block,
  memory: MemoryBlock,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_excel_v2: MicrosoftExcelV2Block,
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  mistral_parse_v2: MistralParseV2Block,
  mistral_parse_v3: MistralParseV3Block,
  mongodb: MongoDBBlock,
  mysql: MySQLBlock,
  neo4j: Neo4jBlock,
  note: NoteBlock,
  notion: NotionBlock,
  notion_v2: NotionV2Block,
  onedrive: OneDriveBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  parallel_ai: ParallelBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  pipedrive: PipedriveBlock,
  polymarket: PolymarketBlock,
  postgresql: PostgreSQLBlock,
  posthog: PostHogBlock,
  pulse: PulseBlock,
  pulse_v2: PulseV2Block,
  qdrant: QdrantBlock,
  rds: RDSBlock,
  reddit: RedditBlock,
  reducto: ReductoBlock,
  reducto_v2: ReductoV2Block,
  resend: ResendBlock,
  response: ResponseBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  s3: S3Block,
  salesforce: SalesforceBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  sendgrid: SendGridBlock,
  sentry: SentryBlock,
  serper: SerperBlock,
  servicenow: ServiceNowBlock,
  sftp: SftpBlock,
  sharepoint: SharepointBlock,
  shopify: ShopifyBlock,
  similarweb: SimilarwebBlock,
  slack: SlackBlock,
  smtp: SmtpBlock,
  spotify: SpotifyBlock,
  sqs: SQSBlock,
  ssh: SSHBlock,
  stagehand: StagehandBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  stripe: StripeBlock,
  stt: SttBlock,
  stt_v2: SttV2Block,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  textract: TextractBlock,
  textract_v2: TextractV2Block,
  thinking: ThinkingBlock,
  tinybird: TinybirdBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  tts: TtsBlock,
  twilio_sms: TwilioSMSBlock,
  twilio_voice: TwilioVoiceBlock,
  typeform: TypeformBlock,
  variables: VariablesBlock,
  video_generator: VideoGeneratorBlock,
  video_generator_v2: VideoGeneratorV2Block,
  vision: VisionBlock,
  vision_v2: VisionV2Block,
  wait: WaitBlock,
  wealthbox: WealthboxBlock,
  webflow: WebflowBlock,
  webhook_request: WebhookRequestBlock,
  whatsapp: WhatsAppBlock,
  wikipedia: WikipediaBlock,
  wordpress: WordPressBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  x: XBlock,
  youtube: YouTubeBlock,
  zendesk: ZendeskBlock,
  zep: ZepBlock,
  zoom: ZoomBlock,
}

export const getBlock = (type: string): BlockConfig | undefined => {
  if (registry[type]) {
    return registry[type]
  }
  const normalized = type.replace(/-/g, '_')
  return registry[normalized]
}

export const getLatestBlock = (baseType: string): BlockConfig | undefined => {
  const normalized = baseType.replace(/-/g, '_')

  const versionedKeys = Object.keys(registry).filter((key) => {
    const match = key.match(new RegExp(`^${normalized}_v(\\d+)$`))
    return match !== null
  })

  if (versionedKeys.length > 0) {
    const sorted = versionedKeys.sort((a, b) => {
      const versionA = Number.parseInt(a.match(/_v(\d+)$/)?.[1] || '0', 10)
      const versionB = Number.parseInt(b.match(/_v(\d+)$/)?.[1] || '0', 10)
      return versionB - versionA
    })
    return registry[sorted[0]]
  }

  return registry[normalized]
}

export const getBlockByToolName = (toolName: string): BlockConfig | undefined => {
  return Object.values(registry).find((block) => block.tools?.access?.includes(toolName))
}

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string =>
  type in registry || type.replace(/-/g, '_') in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
