import { AgentBlock } from '@/blocks/blocks/agent'
import { AhrefsBlock } from '@/blocks/blocks/ahrefs'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { AsanaBlock } from '@/blocks/blocks/asana'
// import { BoxBlock } from '@/blocks/blocks/box' // TODO: Box OAuth integration
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock } from '@/blocks/blocks/circleback'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock } from '@/blocks/blocks/confluence'
import { CursorBlock } from '@/blocks/blocks/cursor'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { DropboxBlock } from '@/blocks/blocks/dropbox'
import { DuckDuckGoBlock } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock } from '@/blocks/blocks/exa'
import { FileBlock } from '@/blocks/blocks/file'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FirefliesBlock } from '@/blocks/blocks/fireflies'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GitHubBlock } from '@/blocks/blocks/github'
import { GitLabBlock } from '@/blocks/blocks/gitlab'
import { GmailBlock } from '@/blocks/blocks/gmail'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleCalendarBlock } from '@/blocks/blocks/google_calendar'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock } from '@/blocks/blocks/google_form'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'
import { GoogleSheetsBlock } from '@/blocks/blocks/google_sheets'
import { GoogleSlidesBlock } from '@/blocks/blocks/google_slides'
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
import { IntercomBlock } from '@/blocks/blocks/intercom'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import { KalshiBlock } from '@/blocks/blocks/kalshi'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LinearBlock } from '@/blocks/blocks/linear'
import { LinkedInBlock } from '@/blocks/blocks/linkedin'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { MailgunBlock } from '@/blocks/blocks/mailgun'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftExcelBlock } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import { MistralParseBlock } from '@/blocks/blocks/mistral_parse'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { MySQLBlock } from '@/blocks/blocks/mysql'
import { Neo4jBlock } from '@/blocks/blocks/neo4j'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotionBlock } from '@/blocks/blocks/notion'
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
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { RDSBlock } from '@/blocks/blocks/rds'
import { RedditBlock } from '@/blocks/blocks/reddit'
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
import { SlackBlock } from '@/blocks/blocks/slack'
import { SmtpBlock } from '@/blocks/blocks/smtp'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import { SSHBlock } from '@/blocks/blocks/ssh'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { SttBlock } from '@/blocks/blocks/stt'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock } from '@/blocks/blocks/trello'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VideoGeneratorBlock } from '@/blocks/blocks/video_generator'
import { VisionBlock } from '@/blocks/blocks/vision'
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
import { SQSBlock } from './blocks/sqs'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  agent: AgentBlock,
  ahrefs: AhrefsBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  apify: ApifyBlock,
  apollo: ApolloBlock,
  arxiv: ArxivBlock,
  asana: AsanaBlock,
  // box: BoxBlock, // TODO: Box OAuth integration
  browser_use: BrowserUseBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  clay: ClayBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  cursor: CursorBlock,
  datadog: DatadogBlock,
  discord: DiscordBlock,
  dropbox: DropboxBlock,
  duckduckgo: DuckDuckGoBlock,
  elevenlabs: ElevenLabsBlock,
  elasticsearch: ElasticsearchBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  file: FileBlock,
  firecrawl: FirecrawlBlock,
  fireflies: FirefliesBlock,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  github: GitHubBlock,
  gitlab: GitLabBlock,
  gmail: GmailBlock,
  grain: GrainBlock,
  grafana: GrafanaBlock,
  greptile: GreptileBlock,
  guardrails: GuardrailsBlock,
  google_calendar: GoogleCalendarBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  google_slides: GoogleSlidesBlock,
  google_vault: GoogleVaultBlock,
  google_groups: GoogleGroupsBlock,
  hubspot: HubSpotBlock,
  huggingface: HuggingFaceBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  hunter: HunterBlock,
  image_generator: ImageGeneratorBlock,
  imap: ImapBlock,
  incidentio: IncidentioBlock,
  input_trigger: InputTriggerBlock,
  intercom: IntercomBlock,
  jina: JinaBlock,
  jira: JiraBlock,
  jira_service_management: JiraServiceManagementBlock,
  kalshi: KalshiBlock,
  knowledge: KnowledgeBlock,
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
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  mongodb: MongoDBBlock,
  mysql: MySQLBlock,
  neo4j: Neo4jBlock,
  note: NoteBlock,
  notion: NotionBlock,
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
  qdrant: QdrantBlock,
  rds: RDSBlock,
  sqs: SQSBlock,
  dynamodb: DynamoDBBlock,
  reddit: RedditBlock,
  resend: ResendBlock,
  response: ResponseBlock,
  rss: RssBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  s3: S3Block,
  salesforce: SalesforceBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  sendgrid: SendGridBlock,
  sentry: SentryBlock,
  servicenow: ServiceNowBlock,
  serper: SerperBlock,
  sharepoint: SharepointBlock,
  shopify: ShopifyBlock,
  slack: SlackBlock,
  spotify: SpotifyBlock,
  smtp: SmtpBlock,
  sftp: SftpBlock,
  ssh: SSHBlock,
  stagehand: StagehandBlock,
  starter: StarterBlock,
  start_trigger: StartTriggerBlock,
  stt: SttBlock,
  tts: TtsBlock,
  stripe: StripeBlock,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  thinking: ThinkingBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  twilio_sms: TwilioSMSBlock,
  twilio_voice: TwilioVoiceBlock,
  typeform: TypeformBlock,
  variables: VariablesBlock,
  video_generator: VideoGeneratorBlock,
  vision: VisionBlock,
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
  zep: ZepBlock,
  zendesk: ZendeskBlock,
  zoom: ZoomBlock,
}

export const getBlock = (type: string): BlockConfig | undefined => {
  if (registry[type]) {
    return registry[type]
  }
  const normalized = type.replace(/-/g, '_')
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
