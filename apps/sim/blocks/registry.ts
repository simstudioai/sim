import { stripVersionSuffix } from '@sim/utils/string'
import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { AgentMailBlock } from '@/blocks/blocks/agentmail'
import { AgentPhoneBlock } from '@/blocks/blocks/agentphone'
import { AgiloftBlock } from '@/blocks/blocks/agiloft'
import { AhrefsBlock } from '@/blocks/blocks/ahrefs'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { AirweaveBlock } from '@/blocks/blocks/airweave'
import { AlgoliaBlock } from '@/blocks/blocks/algolia'
import { AmplitudeBlock } from '@/blocks/blocks/amplitude'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ApifyBlock } from '@/blocks/blocks/apify'
import { ApolloBlock } from '@/blocks/blocks/apollo'
import { AppConfigBlock } from '@/blocks/blocks/appconfig'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { AsanaBlock } from '@/blocks/blocks/asana'
import { AshbyBlock } from '@/blocks/blocks/ashby'
import { AthenaBlock } from '@/blocks/blocks/athena'
import { AttioBlock } from '@/blocks/blocks/attio'
import { AzureDevOpsBlock } from '@/blocks/blocks/azure_devops'
import { BoxBlock } from '@/blocks/blocks/box'
import { BrandfetchBlock } from '@/blocks/blocks/brandfetch'
import { BrexBlock } from '@/blocks/blocks/brex'
import { BrightDataBlock } from '@/blocks/blocks/brightdata'
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { CalComBlock } from '@/blocks/blocks/calcom'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock } from '@/blocks/blocks/circleback'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ClerkBlock } from '@/blocks/blocks/clerk'
import { ClickHouseBlock } from '@/blocks/blocks/clickhouse'
import { CloudflareBlock } from '@/blocks/blocks/cloudflare'
import { CloudFormationBlock } from '@/blocks/blocks/cloudformation'
import { CloudWatchBlock } from '@/blocks/blocks/cloudwatch'
import { CodePipelineBlock } from '@/blocks/blocks/codepipeline'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock, ConfluenceV2Block } from '@/blocks/blocks/confluence'
import { ContextDevBlock } from '@/blocks/blocks/context_dev'
import { ConvexBlock } from '@/blocks/blocks/convex'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { CrowdStrikeBlock } from '@/blocks/blocks/crowdstrike'
import { CursorBlock, CursorV2Block } from '@/blocks/blocks/cursor'
import { DagsterBlock } from '@/blocks/blocks/dagster'
import { DatabricksBlock } from '@/blocks/blocks/databricks'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { DatagmaBlock } from '@/blocks/blocks/datagma'
import { DaytonaBlock } from '@/blocks/blocks/daytona'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'
import { DevinBlock } from '@/blocks/blocks/devin'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { DocuSignBlock } from '@/blocks/blocks/docusign'
import { DropboxBlock } from '@/blocks/blocks/dropbox'
import { DropcontactBlock } from '@/blocks/blocks/dropcontact'
import { DSPyBlock } from '@/blocks/blocks/dspy'
import { DubBlock } from '@/blocks/blocks/dub'
import { DuckDuckGoBlock } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EmailBisonBlock } from '@/blocks/blocks/emailbison'
import { EnrichBlock } from '@/blocks/blocks/enrich'
import { EnrichmentBlock } from '@/blocks/blocks/enrichment'
import { EnrowBlock } from '@/blocks/blocks/enrow'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { EvernoteBlock } from '@/blocks/blocks/evernote'
import { ExaBlock } from '@/blocks/blocks/exa'
import { ExtendBlock, ExtendV2Block } from '@/blocks/blocks/extend'
import { FathomBlock } from '@/blocks/blocks/fathom'
import { FileBlock, FileV2Block, FileV3Block, FileV4Block, FileV5Block } from '@/blocks/blocks/file'
import { FindymailBlock } from '@/blocks/blocks/findymail'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FirefliesBlock, FirefliesV2Block } from '@/blocks/blocks/fireflies'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GammaBlock } from '@/blocks/blocks/gamma'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GitHubBlock, GitHubV2Block } from '@/blocks/blocks/github'
import { GitLabBlock } from '@/blocks/blocks/gitlab'
import { GmailBlock, GmailV2Block } from '@/blocks/blocks/gmail'
import { GongBlock } from '@/blocks/blocks/gong'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleAdsBlock } from '@/blocks/blocks/google_ads'
import { GoogleBigQueryBlock } from '@/blocks/blocks/google_bigquery'
import { GoogleBooksBlock } from '@/blocks/blocks/google_books'
import { GoogleCalendarBlock, GoogleCalendarV2Block } from '@/blocks/blocks/google_calendar'
import { GoogleContactsBlock } from '@/blocks/blocks/google_contacts'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock } from '@/blocks/blocks/google_forms'
import { GoogleGroupsBlock } from '@/blocks/blocks/google_groups'
import { GoogleMapsBlock } from '@/blocks/blocks/google_maps'
import { GoogleMeetBlock } from '@/blocks/blocks/google_meet'
import { GooglePagespeedBlock } from '@/blocks/blocks/google_pagespeed'
import { GoogleSheetsBlock, GoogleSheetsV2Block } from '@/blocks/blocks/google_sheets'
import { GoogleSlidesBlock, GoogleSlidesV2Block } from '@/blocks/blocks/google_slides'
import { GoogleTasksBlock } from '@/blocks/blocks/google_tasks'
import { GoogleTranslateBlock } from '@/blocks/blocks/google_translate'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import { GrafanaBlock } from '@/blocks/blocks/grafana'
import { GrainBlock } from '@/blocks/blocks/grain'
import { GranolaBlock } from '@/blocks/blocks/granola'
import { GreenhouseBlock } from '@/blocks/blocks/greenhouse'
import { GreptileBlock } from '@/blocks/blocks/greptile'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HexBlock } from '@/blocks/blocks/hex'
import { HubSpotBlock } from '@/blocks/blocks/hubspot'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { HunterBlock } from '@/blocks/blocks/hunter'
import { IAMBlock } from '@/blocks/blocks/iam'
import { IcypeasBlock } from '@/blocks/blocks/icypeas'
import { IdentityCenterBlock } from '@/blocks/blocks/identity_center'
import { ImageGeneratorBlock, ImageGeneratorV2Block } from '@/blocks/blocks/image_generator'
import { ImapBlock } from '@/blocks/blocks/imap'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { InfisicalBlock } from '@/blocks/blocks/infisical'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { InstantlyBlock } from '@/blocks/blocks/instantly'
import { IntercomBlock, IntercomV2Block } from '@/blocks/blocks/intercom'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import { KalshiBlock, KalshiV2Block } from '@/blocks/blocks/kalshi'
import { KetchBlock } from '@/blocks/blocks/ketch'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LangsmithBlock } from '@/blocks/blocks/langsmith'
import { LatexBlock } from '@/blocks/blocks/latex'
import { LaunchDarklyBlock } from '@/blocks/blocks/launchdarkly'
import { LeadMagicBlock } from '@/blocks/blocks/leadmagic'
import { LemlistBlock } from '@/blocks/blocks/lemlist'
import { LinearBlock, LinearV2Block } from '@/blocks/blocks/linear'
import { LinkedInBlock } from '@/blocks/blocks/linkedin'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { LinqBlock } from '@/blocks/blocks/linq'
import { LogsBlock, LogsV2Block } from '@/blocks/blocks/logs'
import { LoopsBlock } from '@/blocks/blocks/loops'
import { LumaBlock } from '@/blocks/blocks/luma'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { MailgunBlock } from '@/blocks/blocks/mailgun'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftAdBlock } from '@/blocks/blocks/microsoft_ad'
import { MicrosoftDataverseBlock } from '@/blocks/blocks/microsoft_dataverse'
import { MicrosoftExcelBlock, MicrosoftExcelV2Block } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import { MillionVerifierBlock } from '@/blocks/blocks/millionverifier'
import {
  MistralParseBlock,
  MistralParseV2Block,
  MistralParseV3Block,
} from '@/blocks/blocks/mistral_parse'
import { MondayBlock } from '@/blocks/blocks/monday'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { MothershipBlock } from '@/blocks/blocks/mothership'
import { MySQLBlock } from '@/blocks/blocks/mysql'
import { Neo4jBlock } from '@/blocks/blocks/neo4j'
import { NeverBounceBlock } from '@/blocks/blocks/neverbounce'
import { NewRelicBlock } from '@/blocks/blocks/new_relic'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotionBlock, NotionV2Block } from '@/blocks/blocks/notion'
import { ObsidianBlock } from '@/blocks/blocks/obsidian'
import { OktaBlock } from '@/blocks/blocks/okta'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import { OnePasswordBlock } from '@/blocks/blocks/onepassword'
import { OpenAIBlock } from '@/blocks/blocks/openai'
import { OutlookBlock } from '@/blocks/blocks/outlook'
import { PagerDutyBlock } from '@/blocks/blocks/pagerduty'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { PeopleDataLabsBlock } from '@/blocks/blocks/peopledatalabs'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import { PersonaBlock } from '@/blocks/blocks/persona'
import { PiBlock } from '@/blocks/blocks/pi'
import { PineconeBlock } from '@/blocks/blocks/pinecone'
import { PipedriveBlock } from '@/blocks/blocks/pipedrive'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { PostgreSQLBlock } from '@/blocks/blocks/postgresql'
import { PostHogBlock } from '@/blocks/blocks/posthog'
import { ProfoundBlock } from '@/blocks/blocks/profound'
import { ProspeoBlock } from '@/blocks/blocks/prospeo'
import { PulseBlock, PulseV2Block } from '@/blocks/blocks/pulse'
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { QuartrBlock } from '@/blocks/blocks/quartr'
import { QuiverBlock } from '@/blocks/blocks/quiver'
import { RailwayBlock } from '@/blocks/blocks/railway'
import { RB2BBlock } from '@/blocks/blocks/rb2b'
import { RDSBlock } from '@/blocks/blocks/rds'
import { RedditBlock } from '@/blocks/blocks/reddit'
import { RedisBlock } from '@/blocks/blocks/redis'
import { ReductoBlock, ReductoV2Block } from '@/blocks/blocks/reducto'
import { ResendBlock } from '@/blocks/blocks/resend'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RevenueCatBlock } from '@/blocks/blocks/revenuecat'
import { RipplingBlock } from '@/blocks/blocks/rippling'
import { RootlyBlock } from '@/blocks/blocks/rootly'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock } from '@/blocks/blocks/rss'
import { S3Block } from '@/blocks/blocks/s3'
import { SalesforceBlock } from '@/blocks/blocks/salesforce'
import { SapConcurBlock } from '@/blocks/blocks/sap_concur'
import { SapS4HanaBlock } from '@/blocks/blocks/sap_s4hana'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SecretsManagerBlock } from '@/blocks/blocks/secrets_manager'
import { SendblueBlock } from '@/blocks/blocks/sendblue'
import { SendGridBlock } from '@/blocks/blocks/sendgrid'
import { SentryBlock } from '@/blocks/blocks/sentry'
import { SerperBlock } from '@/blocks/blocks/serper'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { SESBlock } from '@/blocks/blocks/ses'
import { SftpBlock } from '@/blocks/blocks/sftp'
import { SharepointBlock, SharepointV2Block } from '@/blocks/blocks/sharepoint'
import { ShopifyBlock } from '@/blocks/blocks/shopify'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { SimilarwebBlock } from '@/blocks/blocks/similarweb'
import { SixtyfourBlock } from '@/blocks/blocks/sixtyfour'
import { SlackBlock } from '@/blocks/blocks/slack'
import { SmtpBlock } from '@/blocks/blocks/smtp'
import { SportmonksBlock } from '@/blocks/blocks/sportmonks'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import { SQSBlock } from '@/blocks/blocks/sqs'
import { SquareBlock } from '@/blocks/blocks/square'
import { SSHBlock } from '@/blocks/blocks/ssh'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { STSBlock } from '@/blocks/blocks/sts'
import { SttBlock, SttV2Block } from '@/blocks/blocks/stt'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TableBlock } from '@/blocks/blocks/table'
import { TailscaleBlock } from '@/blocks/blocks/tailscale'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { TemporalBlock } from '@/blocks/blocks/temporal'
import { TextractBlock, TextractV2Block } from '@/blocks/blocks/textract'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { ThriveBlock } from '@/blocks/blocks/thrive'
import { TinybirdBlock } from '@/blocks/blocks/tinybird'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock } from '@/blocks/blocks/trello'
import { TriggerDevBlock } from '@/blocks/blocks/trigger_dev'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { UpstashBlock } from '@/blocks/blocks/upstash'
import { VantaBlock } from '@/blocks/blocks/vanta'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VercelBlock } from '@/blocks/blocks/vercel'
import {
  VideoGeneratorBlock,
  VideoGeneratorV2Block,
  VideoGeneratorV3Block,
} from '@/blocks/blocks/video_generator'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { WebflowBlock } from '@/blocks/blocks/webflow'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock } from '@/blocks/blocks/wikipedia'
import { WizaBlock } from '@/blocks/blocks/wiza'
import { WordPressBlock } from '@/blocks/blocks/wordpress'
import { WorkdayBlock } from '@/blocks/blocks/workday'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { XBlock } from '@/blocks/blocks/x'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import { ZendeskBlock } from '@/blocks/blocks/zendesk'
import { ZepBlock } from '@/blocks/blocks/zep'
import { ZeroBounceBlock } from '@/blocks/blocks/zerobounce'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import { ZoomInfoBlock } from '@/blocks/blocks/zoominfo'
import { BLOCK_CATALOG } from '@/blocks/manifest-data'
import type {
  BlockCategory,
  BlockConfig,
  BlockMeta,
  BlockTemplate,
  SuggestedSkill,
} from '@/blocks/types'

/** All block configs keyed by block type. The execution source of truth. */
const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  a2a: A2ABlock,
  agent: AgentBlock,
  agentmail: AgentMailBlock,
  agentphone: AgentPhoneBlock,
  agiloft: AgiloftBlock,
  ahrefs: AhrefsBlock,
  airtable: AirtableBlock,
  airweave: AirweaveBlock,
  algolia: AlgoliaBlock,
  amplitude: AmplitudeBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  apify: ApifyBlock,
  appconfig: AppConfigBlock,
  apollo: ApolloBlock,
  arxiv: ArxivBlock,
  asana: AsanaBlock,
  ashby: AshbyBlock,
  athena: AthenaBlock,
  attio: AttioBlock,
  azure_devops: AzureDevOpsBlock,
  box: BoxBlock,
  brandfetch: BrandfetchBlock,
  brex: BrexBlock,
  brightdata: BrightDataBlock,
  browser_use: BrowserUseBlock,
  calcom: CalComBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  clay: ClayBlock,
  clerk: ClerkBlock,
  clickhouse: ClickHouseBlock,
  cloudflare: CloudflareBlock,
  cloudformation: CloudFormationBlock,
  cloudwatch: CloudWatchBlock,
  codepipeline: CodePipelineBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  confluence_v2: ConfluenceV2Block,
  context_dev: ContextDevBlock,
  convex: ConvexBlock,
  credential: CredentialBlock,
  crowdstrike: CrowdStrikeBlock,
  cursor: CursorBlock,
  cursor_v2: CursorV2Block,
  dagster: DagsterBlock,
  databricks: DatabricksBlock,
  datadog: DatadogBlock,
  datagma: DatagmaBlock,
  daytona: DaytonaBlock,
  deployments: DeploymentsBlock,
  devin: DevinBlock,
  discord: DiscordBlock,
  docusign: DocuSignBlock,
  dropbox: DropboxBlock,
  dropcontact: DropcontactBlock,
  dspy: DSPyBlock,
  dub: DubBlock,
  duckduckgo: DuckDuckGoBlock,
  dynamodb: DynamoDBBlock,
  elasticsearch: ElasticsearchBlock,
  elevenlabs: ElevenLabsBlock,
  emailbison: EmailBisonBlock,
  enrich: EnrichBlock,
  enrichment: EnrichmentBlock,
  enrow: EnrowBlock,
  evaluator: EvaluatorBlock,
  evernote: EvernoteBlock,
  exa: ExaBlock,
  extend: ExtendBlock,
  extend_v2: ExtendV2Block,
  fathom: FathomBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  file_v4: FileV4Block,
  file_v5: FileV5Block,
  findymail: FindymailBlock,
  zerobounce: ZeroBounceBlock,
  neverbounce: NeverBounceBlock,
  millionverifier: MillionVerifierBlock,
  firecrawl: FirecrawlBlock,
  fireflies: FirefliesBlock,
  fireflies_v2: FirefliesV2Block,
  function: FunctionBlock,
  gamma: GammaBlock,
  generic_webhook: GenericWebhookBlock,
  github: GitHubBlock,
  github_v2: GitHubV2Block,
  gitlab: GitLabBlock,
  gmail: GmailBlock,
  gmail_v2: GmailV2Block,
  gong: GongBlock,
  google_ads: GoogleAdsBlock,
  google_bigquery: GoogleBigQueryBlock,
  google_books: GoogleBooksBlock,
  google_calendar: GoogleCalendarBlock,
  google_calendar_v2: GoogleCalendarV2Block,
  google_contacts: GoogleContactsBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_groups: GoogleGroupsBlock,
  google_maps: GoogleMapsBlock,
  google_meet: GoogleMeetBlock,
  google_pagespeed: GooglePagespeedBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  google_sheets_v2: GoogleSheetsV2Block,
  google_slides: GoogleSlidesBlock,
  google_slides_v2: GoogleSlidesV2Block,
  google_tasks: GoogleTasksBlock,
  google_translate: GoogleTranslateBlock,
  google_vault: GoogleVaultBlock,
  grafana: GrafanaBlock,
  grain: GrainBlock,
  granola: GranolaBlock,
  greenhouse: GreenhouseBlock,
  greptile: GreptileBlock,
  guardrails: GuardrailsBlock,
  hex: HexBlock,
  hubspot: HubSpotBlock,
  huggingface: HuggingFaceBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  hunter: HunterBlock,
  iam: IAMBlock,
  icypeas: IcypeasBlock,
  identity_center: IdentityCenterBlock,
  image_generator: ImageGeneratorBlock,
  image_generator_v2: ImageGeneratorV2Block,
  imap: ImapBlock,
  incidentio: IncidentioBlock,
  infisical: InfisicalBlock,
  input_trigger: InputTriggerBlock,
  instantly: InstantlyBlock,
  intercom: IntercomBlock,
  intercom_v2: IntercomV2Block,
  jina: JinaBlock,
  jira: JiraBlock,
  jira_service_management: JiraServiceManagementBlock,
  kalshi: KalshiBlock,
  kalshi_v2: KalshiV2Block,
  ketch: KetchBlock,
  knowledge: KnowledgeBlock,
  langsmith: LangsmithBlock,
  latex: LatexBlock,
  launchdarkly: LaunchDarklyBlock,
  leadmagic: LeadMagicBlock,
  lemlist: LemlistBlock,
  linear: LinearBlock,
  linear_v2: LinearV2Block,
  linkedin: LinkedInBlock,
  linkup: LinkupBlock,
  linq: LinqBlock,
  logs: LogsBlock,
  logs_v2: LogsV2Block,
  loops: LoopsBlock,
  luma: LumaBlock,
  mailchimp: MailchimpBlock,
  mailgun: MailgunBlock,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  mem0: Mem0Block,
  memory: MemoryBlock,
  microsoft_ad: MicrosoftAdBlock,
  microsoft_dataverse: MicrosoftDataverseBlock,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_excel_v2: MicrosoftExcelV2Block,
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  mistral_parse_v2: MistralParseV2Block,
  mistral_parse_v3: MistralParseV3Block,
  monday: MondayBlock,
  mongodb: MongoDBBlock,
  mothership: MothershipBlock,
  mysql: MySQLBlock,
  neo4j: Neo4jBlock,
  new_relic: NewRelicBlock,
  note: NoteBlock,
  notion: NotionBlock,
  notion_v2: NotionV2Block,
  obsidian: ObsidianBlock,
  okta: OktaBlock,
  onedrive: OneDriveBlock,
  onepassword: OnePasswordBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  pagerduty: PagerDutyBlock,
  parallel_ai: ParallelBlock,
  peopledatalabs: PeopleDataLabsBlock,
  perplexity: PerplexityBlock,
  persona: PersonaBlock,
  pi: PiBlock,
  pinecone: PineconeBlock,
  pipedrive: PipedriveBlock,
  polymarket: PolymarketBlock,
  postgresql: PostgreSQLBlock,
  posthog: PostHogBlock,
  profound: ProfoundBlock,
  prospeo: ProspeoBlock,
  pulse: PulseBlock,
  pulse_v2: PulseV2Block,
  qdrant: QdrantBlock,
  quartr: QuartrBlock,
  quiver: QuiverBlock,
  railway: RailwayBlock,
  rb2b: RB2BBlock,
  rds: RDSBlock,
  reddit: RedditBlock,
  redis: RedisBlock,
  reducto: ReductoBlock,
  reducto_v2: ReductoV2Block,
  resend: ResendBlock,
  response: ResponseBlock,
  revenuecat: RevenueCatBlock,
  rippling: RipplingBlock,
  rootly: RootlyBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  s3: S3Block,
  salesforce: SalesforceBlock,
  sap_concur: SapConcurBlock,
  sap_s4hana: SapS4HanaBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  secrets_manager: SecretsManagerBlock,
  sendblue: SendblueBlock,
  sendgrid: SendGridBlock,
  sentry: SentryBlock,
  serper: SerperBlock,
  servicenow: ServiceNowBlock,
  ses: SESBlock,
  sftp: SftpBlock,
  sharepoint: SharepointBlock,
  sharepoint_v2: SharepointV2Block,
  shopify: ShopifyBlock,
  sim_workspace_event: SimWorkspaceEventBlock,
  similarweb: SimilarwebBlock,
  sixtyfour: SixtyfourBlock,
  slack: SlackBlock,
  smtp: SmtpBlock,
  sportmonks: SportmonksBlock,
  spotify: SpotifyBlock,
  sqs: SQSBlock,
  square: SquareBlock,
  ssh: SSHBlock,
  stagehand: StagehandBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  stripe: StripeBlock,
  sts: STSBlock,
  stt: SttBlock,
  stt_v2: SttV2Block,
  supabase: SupabaseBlock,
  table: TableBlock,
  tailscale: TailscaleBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  temporal: TemporalBlock,
  textract: TextractBlock,
  textract_v2: TextractV2Block,
  thinking: ThinkingBlock,
  thrive: ThriveBlock,
  tinybird: TinybirdBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  trigger_dev: TriggerDevBlock,
  tts: TtsBlock,
  twilio_sms: TwilioSMSBlock,
  twilio_voice: TwilioVoiceBlock,
  typeform: TypeformBlock,
  upstash: UpstashBlock,
  vanta: VantaBlock,
  variables: VariablesBlock,
  vercel: VercelBlock,
  video_generator: VideoGeneratorBlock,
  video_generator_v2: VideoGeneratorV2Block,
  video_generator_v3: VideoGeneratorV3Block,
  vision: VisionBlock,
  vision_v2: VisionV2Block,
  wait: WaitBlock,
  wealthbox: WealthboxBlock,
  webflow: WebflowBlock,
  webhook_request: WebhookRequestBlock,
  whatsapp: WhatsAppBlock,
  wikipedia: WikipediaBlock,
  wiza: WizaBlock,
  wordpress: WordPressBlock,
  workday: WorkdayBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  x: XBlock,
  youtube: YouTubeBlock,
  zendesk: ZendeskBlock,
  zep: ZepBlock,
  zoom: ZoomBlock,
  zoominfo: ZoomInfoBlock,
}

/**
 * Normalize an external block type to its registry key form: dashes become
 * underscores (some external sources use either form).
 */
function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

/** Get the block config for a single block type. */
export function getBlock(type: string): BlockConfig | undefined {
  return BLOCK_REGISTRY[type] ?? BLOCK_REGISTRY[normalizeType(type)]
}

/** All block configs. */
export function getAllBlocks(): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY)
}

/** Find the block whose `tools.access` contains the given tool id. */
export function getBlockByToolName(toolName: string): BlockConfig | undefined {
  return Object.values(BLOCK_REGISTRY).find((b) => b.tools?.access?.includes(toolName))
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation. Returns the registry key alongside the
 * config so callers that need the canonical type identifier avoid re-deriving
 * it.
 */
function resolveLatest(baseType: string): { type: string; config: BlockConfig } | undefined {
  const normalized = normalizeType(baseType)
  const versionPattern = new RegExp(`^${normalized}_v(\\d+)$`)
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of Object.keys(BLOCK_REGISTRY)) {
    const match = key.match(versionPattern)
    if (!match) continue
    const version = Number.parseInt(match[1]!, 10)
    if (version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  if (latestKey) return { type: latestKey, config: BLOCK_REGISTRY[latestKey]! }
  const config = BLOCK_REGISTRY[normalized]
  return config ? { type: normalized, config } : undefined
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation.
 */
export function getLatestBlock(baseType: string): BlockConfig | undefined {
  return resolveLatest(baseType)?.config
}

/** All blocks in a given category. */
export function getBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter((block) => block.category === category)
}

/**
 * The canonical "latest-version, toolbar-visible" set of blocks for a
 * category. This is the single source of truth shared by every surface that
 * extracts blocks for presentation — the toolbar, the search/mention engine,
 * and the integrations catalog. A block is included when its `category`
 * matches and it is not hidden from the toolbar (i.e. it is the latest
 * version under the upgrade paradigm, since superseded versions set
 * `hideFromToolbar: true`).
 */
export function getCanonicalBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter(
    (block) => block.category === category && !block.hideFromToolbar
  )
}

/** All registered block type identifiers. */
export function getAllBlockTypes(): string[] {
  return Object.keys(BLOCK_REGISTRY)
}

/** Whether the given string is a registered block type. Accepts hyphens as a dash-form alias. */
export function isValidBlockType(type: string): type is string {
  return type in BLOCK_REGISTRY || normalizeType(type) in BLOCK_REGISTRY
}

/**
 * Get the presentation/catalog meta for a block type, resolving through the
 * version suffix the same way {@link getTemplatesForBlock} does. Metas are
 * keyed under the base type (e.g. `confluence`, not `confluence_v2`), so a
 * versioned lookup falls back to the stripped base.
 */
export function getBlockMeta(type: string): BlockMeta | undefined {
  const normalized = normalizeType(type)
  return (
    BLOCK_CATALOG[type] ??
    BLOCK_CATALOG[normalized] ??
    BLOCK_CATALOG[stripVersionSuffix(normalized)]
  )
}

/** All block metas keyed by block type. */
export function getAllBlockMeta(): Record<string, BlockMeta> {
  return BLOCK_CATALOG
}

/**
 * A template scoped to a viewing block, enriched with `otherBlockTypes` —
 * the integrations to render alongside the viewer in the icon cluster.
 * Includes the template's owner block whenever the viewer is not the owner.
 */
export interface ScopedBlockTemplate extends BlockTemplate {
  /** Block types (base form) to render alongside the viewing block in the icon cluster. */
  otherBlockTypes: readonly string[]
}

/**
 * All templates whose owner block is `type` or which list `type` in their
 * `alsoIntegrations`. Each returned template carries `otherBlockTypes` —
 * the non-viewing integrations (owner + other alsoIntegrations) for icon
 * cluster rendering.
 */
export function getTemplatesForBlock(type: string): ScopedBlockTemplate[] {
  const base = stripVersionSuffix(type)
  const collected: ScopedBlockTemplate[] = []
  for (const [ownerType, meta] of Object.entries(BLOCK_CATALOG)) {
    if (!meta.templates) continue
    const ownerBase = stripVersionSuffix(ownerType)
    const isOwnerMatch = ownerBase === base
    for (const template of meta.templates) {
      const isAlsoMatch =
        template.alsoIntegrations?.includes(base) || template.alsoIntegrations?.includes(type)
      if (!isOwnerMatch && !isAlsoMatch) continue
      const others: string[] = []
      if (!isOwnerMatch) others.push(ownerBase)
      for (const also of template.alsoIntegrations ?? []) {
        const alsoBase = stripVersionSuffix(also)
        if (alsoBase !== base && !others.includes(alsoBase)) others.push(alsoBase)
      }
      collected.push({ ...template, otherBlockTypes: others })
    }
  }
  return collected
}

/**
 * Popular, ready-to-add skills for a block type. Curated skills live on the
 * base integration's meta, but a versioned catalog type (e.g. `notion_v2`) has
 * its own meta entry that {@link getBlockMeta} resolves first and which may omit
 * skills — so fall back to the stripped base meta. Returns an empty array when
 * the integration has no curated skills.
 */
export function getSuggestedSkillsForBlock(type: string): readonly SuggestedSkill[] {
  const direct = getBlockMeta(type)?.skills
  if (direct && direct.length > 0) return direct
  const base = stripVersionSuffix(normalizeType(type))
  return BLOCK_CATALOG[base]?.skills ?? []
}

/**
 * Raw block registry map keyed by block type. Prefer the typed accessors
 * (`getBlock`, `getAllBlocks`, `getCanonicalBlocksByCategory`); this alias is
 * retained for callers that need the underlying record directly.
 */
export const registry: Record<string, BlockConfig> = BLOCK_REGISTRY

export type { BlockCategory }
