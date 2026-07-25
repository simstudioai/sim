import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { AgentMailBlock, AgentMailBlockMeta } from '@/blocks/blocks/agentmail'
import { AgentPhoneBlock, AgentPhoneBlockMeta } from '@/blocks/blocks/agentphone'
import { AgiloftBlock, AgiloftBlockMeta } from '@/blocks/blocks/agiloft'
import { AhrefsBlock, AhrefsBlockMeta } from '@/blocks/blocks/ahrefs'
import { AirtableBlock, AirtableBlockMeta } from '@/blocks/blocks/airtable'
import { AirweaveBlock, AirweaveBlockMeta } from '@/blocks/blocks/airweave'
import { AlgoliaBlock, AlgoliaBlockMeta } from '@/blocks/blocks/algolia'
import { AmplitudeBlock, AmplitudeBlockMeta } from '@/blocks/blocks/amplitude'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ApifyBlock, ApifyBlockMeta } from '@/blocks/blocks/apify'
import { ApolloBlock, ApolloBlockMeta } from '@/blocks/blocks/apollo'
import { AppConfigBlock, AppConfigBlockMeta } from '@/blocks/blocks/appconfig'
import { ArxivBlock, ArxivBlockMeta } from '@/blocks/blocks/arxiv'
import { AsanaBlock, AsanaBlockMeta } from '@/blocks/blocks/asana'
import { AshbyBlock, AshbyBlockMeta } from '@/blocks/blocks/ashby'
import { AthenaBlock, AthenaBlockMeta } from '@/blocks/blocks/athena'
import { AttioBlock, AttioBlockMeta } from '@/blocks/blocks/attio'
import { AzureDevOpsBlock, AzureDevOpsBlockMeta } from '@/blocks/blocks/azure_devops'
import { BoxBlock, BoxBlockMeta } from '@/blocks/blocks/box'
import { BrandfetchBlock, BrandfetchBlockMeta } from '@/blocks/blocks/brandfetch'
import { BrexBlock, BrexBlockMeta } from '@/blocks/blocks/brex'
import { BrightDataBlock, BrightDataBlockMeta } from '@/blocks/blocks/brightdata'
import { BrowserUseBlock, BrowserUseBlockMeta } from '@/blocks/blocks/browser_use'
import { BufferBlock, BufferBlockMeta } from '@/blocks/blocks/buffer'
import { CalComBlock, CalComBlockMeta } from '@/blocks/blocks/calcom'
import { CalendlyBlock, CalendlyBlockMeta } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock, CirclebackBlockMeta } from '@/blocks/blocks/circleback'
import { ClayBlock, ClayBlockMeta } from '@/blocks/blocks/clay'
import { ClerkBlock, ClerkBlockMeta } from '@/blocks/blocks/clerk'
import { ClickHouseBlock, ClickHouseBlockMeta } from '@/blocks/blocks/clickhouse'
import { ClickUpBlock, ClickUpBlockMeta } from '@/blocks/blocks/clickup'
import { CloudflareBlock, CloudflareBlockMeta } from '@/blocks/blocks/cloudflare'
import { CloudFormationBlock, CloudFormationBlockMeta } from '@/blocks/blocks/cloudformation'
import { CloudWatchBlock, CloudWatchBlockMeta } from '@/blocks/blocks/cloudwatch'
import { CodePipelineBlock, CodePipelineBlockMeta } from '@/blocks/blocks/codepipeline'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock, ConfluenceBlockMeta, ConfluenceV2Block } from '@/blocks/blocks/confluence'
import { ContextDevBlock, ContextDevBlockMeta } from '@/blocks/blocks/context_dev'
import { ConvexBlock, ConvexBlockMeta } from '@/blocks/blocks/convex'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { CrowdStrikeBlock, CrowdStrikeBlockMeta } from '@/blocks/blocks/crowdstrike'
import { CursorBlock, CursorBlockMeta, CursorV2Block } from '@/blocks/blocks/cursor'
import { DagsterBlock, DagsterBlockMeta } from '@/blocks/blocks/dagster'
import { DatabricksBlock, DatabricksBlockMeta } from '@/blocks/blocks/databricks'
import { DatadogBlock, DatadogBlockMeta } from '@/blocks/blocks/datadog'
import { DatagmaBlock, DatagmaBlockMeta } from '@/blocks/blocks/datagma'
import { DaytonaBlock, DaytonaBlockMeta } from '@/blocks/blocks/daytona'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'
import { DevinBlock, DevinBlockMeta } from '@/blocks/blocks/devin'
import { DiscordBlock, DiscordBlockMeta } from '@/blocks/blocks/discord'
import { DocuSignBlock, DocuSignBlockMeta } from '@/blocks/blocks/docusign'
import { DowndetectorBlock, DowndetectorBlockMeta } from '@/blocks/blocks/downdetector'
import { DropboxBlock, DropboxBlockMeta } from '@/blocks/blocks/dropbox'
import { DropcontactBlock, DropcontactBlockMeta } from '@/blocks/blocks/dropcontact'
import { DSPyBlock, DSPyBlockMeta } from '@/blocks/blocks/dspy'
import { DubBlock, DubBlockMeta } from '@/blocks/blocks/dub'
import { DuckDuckGoBlock, DuckDuckGoBlockMeta } from '@/blocks/blocks/duckduckgo'
import { DynamoDBBlock, DynamoDBBlockMeta } from '@/blocks/blocks/dynamodb'
import { ElasticsearchBlock, ElasticsearchBlockMeta } from '@/blocks/blocks/elasticsearch'
import { ElevenLabsBlock, ElevenLabsBlockMeta } from '@/blocks/blocks/elevenlabs'
import { EmailBisonBlock, EmailBisonBlockMeta } from '@/blocks/blocks/emailbison'
import { EnrichBlock, EnrichBlockMeta } from '@/blocks/blocks/enrich'
import { EnrichmentBlock, EnrichmentBlockMeta } from '@/blocks/blocks/enrichment'
import { EnrowBlock, EnrowBlockMeta } from '@/blocks/blocks/enrow'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { EvernoteBlock, EvernoteBlockMeta } from '@/blocks/blocks/evernote'
import { ExaBlock, ExaBlockMeta } from '@/blocks/blocks/exa'
import { ExtendBlock, ExtendBlockMeta, ExtendV2Block } from '@/blocks/blocks/extend'
import { FathomBlock, FathomBlockMeta } from '@/blocks/blocks/fathom'
import { FileBlock, FileV2Block, FileV3Block, FileV4Block, FileV5Block } from '@/blocks/blocks/file'
import { FindymailBlock, FindymailBlockMeta } from '@/blocks/blocks/findymail'
import { FirecrawlBlock, FirecrawlBlockMeta } from '@/blocks/blocks/firecrawl'
import {
  FirefliesBlock,
  FirefliesBlockMeta,
  FirefliesV2Block,
  FirefliesV2BlockMeta,
} from '@/blocks/blocks/fireflies'
import { FlintBlock, FlintBlockMeta } from '@/blocks/blocks/flint'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GammaBlock, GammaBlockMeta } from '@/blocks/blocks/gamma'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import {
  GitHubBlock,
  GitHubBlockMeta,
  GitHubV2Block,
  GitHubV2BlockMeta,
} from '@/blocks/blocks/github'
import { GitLabBlock, GitLabBlockMeta } from '@/blocks/blocks/gitlab'
import { GmailBlock, GmailBlockMeta, GmailV2Block, GmailV2BlockMeta } from '@/blocks/blocks/gmail'
import { GongBlock, GongBlockMeta } from '@/blocks/blocks/gong'
import { GoogleSearchBlock, GoogleSearchBlockMeta } from '@/blocks/blocks/google'
import { GoogleAdsBlock, GoogleAdsBlockMeta } from '@/blocks/blocks/google_ads'
import { GoogleAppsheetBlock, GoogleAppsheetBlockMeta } from '@/blocks/blocks/google_appsheet'
import { GoogleBigQueryBlock, GoogleBigQueryBlockMeta } from '@/blocks/blocks/google_bigquery'
import { GoogleBooksBlock, GoogleBooksBlockMeta } from '@/blocks/blocks/google_books'
import {
  GoogleCalendarBlock,
  GoogleCalendarBlockMeta,
  GoogleCalendarV2Block,
  GoogleCalendarV2BlockMeta,
} from '@/blocks/blocks/google_calendar'
import { GoogleContactsBlock, GoogleContactsBlockMeta } from '@/blocks/blocks/google_contacts'
import { GoogleDocsBlock, GoogleDocsBlockMeta } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock, GoogleDriveBlockMeta } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock, GoogleFormsBlockMeta } from '@/blocks/blocks/google_forms'
import { GoogleGroupsBlock, GoogleGroupsBlockMeta } from '@/blocks/blocks/google_groups'
import { GoogleMapsBlock, GoogleMapsBlockMeta } from '@/blocks/blocks/google_maps'
import { GoogleMeetBlock, GoogleMeetBlockMeta } from '@/blocks/blocks/google_meet'
import { GooglePagespeedBlock, GooglePagespeedBlockMeta } from '@/blocks/blocks/google_pagespeed'
import {
  GoogleSheetsBlock,
  GoogleSheetsBlockMeta,
  GoogleSheetsV2Block,
  GoogleSheetsV2BlockMeta,
} from '@/blocks/blocks/google_sheets'
import {
  GoogleSlidesBlock,
  GoogleSlidesBlockMeta,
  GoogleSlidesV2Block,
  GoogleSlidesV2BlockMeta,
} from '@/blocks/blocks/google_slides'
import { GoogleTasksBlock, GoogleTasksBlockMeta } from '@/blocks/blocks/google_tasks'
import { GoogleTranslateBlock, GoogleTranslateBlockMeta } from '@/blocks/blocks/google_translate'
import { GoogleVaultBlock, GoogleVaultBlockMeta } from '@/blocks/blocks/google_vault'
import { GrafanaBlock, GrafanaBlockMeta } from '@/blocks/blocks/grafana'
import { GrainBlock, GrainBlockMeta, GrainV2Block, GrainV2BlockMeta } from '@/blocks/blocks/grain'
import { GranolaBlock, GranolaBlockMeta } from '@/blocks/blocks/granola'
import { GreenhouseBlock, GreenhouseBlockMeta } from '@/blocks/blocks/greenhouse'
import { GreptileBlock, GreptileBlockMeta } from '@/blocks/blocks/greptile'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HexBlock, HexBlockMeta } from '@/blocks/blocks/hex'
import { HubSpotBlock, HubSpotBlockMeta } from '@/blocks/blocks/hubspot'
import { HuggingFaceBlock, HuggingFaceBlockMeta } from '@/blocks/blocks/huggingface'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { HunterBlock, HunterBlockMeta } from '@/blocks/blocks/hunter'
import { IAMBlock, IAMBlockMeta } from '@/blocks/blocks/iam'
import { IcypeasBlock, IcypeasBlockMeta } from '@/blocks/blocks/icypeas'
import { IdentityCenterBlock, IdentityCenterBlockMeta } from '@/blocks/blocks/identity_center'
import { ImageGeneratorBlock, ImageGeneratorV2Block } from '@/blocks/blocks/image_generator'
import { ImapBlock, ImapBlockMeta } from '@/blocks/blocks/imap'
import { IncidentioBlock, IncidentioBlockMeta } from '@/blocks/blocks/incidentio'
import { InfisicalBlock, InfisicalBlockMeta } from '@/blocks/blocks/infisical'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { InstagramBlock, InstagramBlockMeta } from '@/blocks/blocks/instagram'
import { InstantlyBlock, InstantlyBlockMeta } from '@/blocks/blocks/instantly'
import {
  IntercomBlock,
  IntercomBlockMeta,
  IntercomV2Block,
  IntercomV2BlockMeta,
} from '@/blocks/blocks/intercom'
import { JinaBlock, JinaBlockMeta } from '@/blocks/blocks/jina'
import { JiraBlock, JiraBlockMeta } from '@/blocks/blocks/jira'
import {
  JiraServiceManagementBlock,
  JiraServiceManagementBlockMeta,
} from '@/blocks/blocks/jira_service_management'
import { JupyterBlock, JupyterBlockMeta } from '@/blocks/blocks/jupyter'
import {
  KalshiBlock,
  KalshiBlockMeta,
  KalshiV2Block,
  KalshiV2BlockMeta,
} from '@/blocks/blocks/kalshi'
import { KetchBlock, KetchBlockMeta } from '@/blocks/blocks/ketch'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LangsmithBlock, LangsmithBlockMeta } from '@/blocks/blocks/langsmith'
import { LatexBlock, LatexBlockMeta } from '@/blocks/blocks/latex'
import { LaunchDarklyBlock, LaunchDarklyBlockMeta } from '@/blocks/blocks/launchdarkly'
import { LeadMagicBlock, LeadMagicBlockMeta } from '@/blocks/blocks/leadmagic'
import { LemlistBlock, LemlistBlockMeta } from '@/blocks/blocks/lemlist'
import { LinearBlock, LinearBlockMeta, LinearV2Block } from '@/blocks/blocks/linear'
import { LinkedInBlock, LinkedInBlockMeta } from '@/blocks/blocks/linkedin'
import { LinkupBlock, LinkupBlockMeta } from '@/blocks/blocks/linkup'
import { LinqBlock, LinqBlockMeta } from '@/blocks/blocks/linq'
import { LogsBlock, LogsV2Block } from '@/blocks/blocks/logs'
import { LoopsBlock, LoopsBlockMeta } from '@/blocks/blocks/loops'
import { LumaBlock, LumaBlockMeta } from '@/blocks/blocks/luma'
import { MailchimpBlock, MailchimpBlockMeta } from '@/blocks/blocks/mailchimp'
import { MailgunBlock, MailgunBlockMeta } from '@/blocks/blocks/mailgun'
import { ManagedAgentBlock, ManagedAgentBlockMeta } from '@/blocks/blocks/managed_agent'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { Mem0Block, Mem0BlockMeta } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftAdBlock, MicrosoftAdBlockMeta } from '@/blocks/blocks/microsoft_ad'
import {
  MicrosoftDataverseBlock,
  MicrosoftDataverseBlockMeta,
} from '@/blocks/blocks/microsoft_dataverse'
import {
  MicrosoftExcelBlock,
  MicrosoftExcelBlockMeta,
  MicrosoftExcelV2Block,
  MicrosoftExcelV2BlockMeta,
} from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock, MicrosoftPlannerBlockMeta } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock, MicrosoftTeamsBlockMeta } from '@/blocks/blocks/microsoft_teams'
import { MillionVerifierBlock, MillionVerifierBlockMeta } from '@/blocks/blocks/millionverifier'
import {
  MistralParseBlock,
  MistralParseBlockMeta,
  MistralParseV2Block,
  MistralParseV3Block,
} from '@/blocks/blocks/mistral_parse'
import { MondayBlock, MondayBlockMeta } from '@/blocks/blocks/monday'
import { MongoDBBlock, MongoDBBlockMeta } from '@/blocks/blocks/mongodb'
import { MothershipBlock } from '@/blocks/blocks/mothership'
import { MySQLBlock, MySQLBlockMeta } from '@/blocks/blocks/mysql'
import { Neo4jBlock, Neo4jBlockMeta } from '@/blocks/blocks/neo4j'
import { NeverBounceBlock, NeverBounceBlockMeta } from '@/blocks/blocks/neverbounce'
import { NewRelicBlock, NewRelicBlockMeta } from '@/blocks/blocks/new_relic'
import { NoteBlock } from '@/blocks/blocks/note'
import {
  NotionBlock,
  NotionBlockMeta,
  NotionV2Block,
  NotionV2BlockMeta,
} from '@/blocks/blocks/notion'
import { ObsidianBlock, ObsidianBlockMeta } from '@/blocks/blocks/obsidian'
import { OktaBlock, OktaBlockMeta } from '@/blocks/blocks/okta'
import { OneDriveBlock, OneDriveBlockMeta } from '@/blocks/blocks/onedrive'
import { OnePasswordBlock, OnePasswordBlockMeta } from '@/blocks/blocks/onepassword'
import { OpenAIBlock, OpenAIBlockMeta } from '@/blocks/blocks/openai'
import { OutlookBlock, OutlookBlockMeta } from '@/blocks/blocks/outlook'
import { PagerDutyBlock, PagerDutyBlockMeta } from '@/blocks/blocks/pagerduty'
import { ParallelBlock, ParallelBlockMeta } from '@/blocks/blocks/parallel'
import { PeopleDataLabsBlock, PeopleDataLabsBlockMeta } from '@/blocks/blocks/peopledatalabs'
import { PerplexityBlock, PerplexityBlockMeta } from '@/blocks/blocks/perplexity'
import { PersonaBlock, PersonaBlockMeta } from '@/blocks/blocks/persona'
import { PiBlock } from '@/blocks/blocks/pi'
import { PineconeBlock, PineconeBlockMeta } from '@/blocks/blocks/pinecone'
import { PipedriveBlock, PipedriveBlockMeta } from '@/blocks/blocks/pipedrive'
import { PolymarketBlock, PolymarketBlockMeta } from '@/blocks/blocks/polymarket'
import { PostgreSQLBlock, PostgreSQLBlockMeta } from '@/blocks/blocks/postgresql'
import { PostHogBlock, PostHogBlockMeta } from '@/blocks/blocks/posthog'
import { ProfoundBlock, ProfoundBlockMeta } from '@/blocks/blocks/profound'
import { ProspeoBlock, ProspeoBlockMeta } from '@/blocks/blocks/prospeo'
import { PulseBlock, PulseBlockMeta, PulseV2Block } from '@/blocks/blocks/pulse'
import { QdrantBlock, QdrantBlockMeta } from '@/blocks/blocks/qdrant'
import { QuartrBlock, QuartrBlockMeta } from '@/blocks/blocks/quartr'
import { QuiverBlock, QuiverBlockMeta } from '@/blocks/blocks/quiver'
import { RailwayBlock, RailwayBlockMeta } from '@/blocks/blocks/railway'
import { RB2BBlock, RB2BBlockMeta } from '@/blocks/blocks/rb2b'
import { RDSBlock, RDSBlockMeta } from '@/blocks/blocks/rds'
import { RedditBlock, RedditBlockMeta } from '@/blocks/blocks/reddit'
import { RedisBlock, RedisBlockMeta } from '@/blocks/blocks/redis'
import { ReductoBlock, ReductoBlockMeta, ReductoV2Block } from '@/blocks/blocks/reducto'
import { ResendBlock, ResendBlockMeta } from '@/blocks/blocks/resend'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RevenueCatBlock, RevenueCatBlockMeta } from '@/blocks/blocks/revenuecat'
import { RipplingBlock, RipplingBlockMeta } from '@/blocks/blocks/rippling'
import { RocketlaneBlock, RocketlaneBlockMeta } from '@/blocks/blocks/rocketlane'
import { RootlyBlock, RootlyBlockMeta } from '@/blocks/blocks/rootly'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock, RssBlockMeta } from '@/blocks/blocks/rss'
import { S3Block, S3BlockMeta } from '@/blocks/blocks/s3'
import { SalesforceBlock, SalesforceBlockMeta } from '@/blocks/blocks/salesforce'
import { SapConcurBlock, SapConcurBlockMeta } from '@/blocks/blocks/sap_concur'
import { SapS4HanaBlock, SapS4HanaBlockMeta } from '@/blocks/blocks/sap_s4hana'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SecretsManagerBlock, SecretsManagerBlockMeta } from '@/blocks/blocks/secrets_manager'
import { SendblueBlock, SendblueBlockMeta } from '@/blocks/blocks/sendblue'
import { SendGridBlock, SendGridBlockMeta } from '@/blocks/blocks/sendgrid'
import { SentryBlock, SentryBlockMeta } from '@/blocks/blocks/sentry'
import { SerpdiveBlock, SerpdiveBlockMeta } from '@/blocks/blocks/serpdive'
import { SerperBlock, SerperBlockMeta } from '@/blocks/blocks/serper'
import { ServiceNowBlock, ServiceNowBlockMeta } from '@/blocks/blocks/servicenow'
import { SESBlock, SESBlockMeta } from '@/blocks/blocks/ses'
import { SftpBlock, SftpBlockMeta } from '@/blocks/blocks/sftp'
import { SharepointBlock, SharepointBlockMeta, SharepointV2Block } from '@/blocks/blocks/sharepoint'
import { ShopifyBlock, ShopifyBlockMeta } from '@/blocks/blocks/shopify'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { SimilarwebBlock, SimilarwebBlockMeta } from '@/blocks/blocks/similarweb'
import { SixtyfourBlock, SixtyfourBlockMeta } from '@/blocks/blocks/sixtyfour'
import { SlackBlock, SlackBlockMeta, SlackV2Block } from '@/blocks/blocks/slack'
import { SmtpBlock, SmtpBlockMeta } from '@/blocks/blocks/smtp'
import { SportmonksBlock, SportmonksBlockMeta } from '@/blocks/blocks/sportmonks'
import { SpotifyBlock, SpotifyBlockMeta } from '@/blocks/blocks/spotify'
import { SQSBlock, SQSBlockMeta } from '@/blocks/blocks/sqs'
import { SquareBlock, SquareBlockMeta } from '@/blocks/blocks/square'
import { SSHBlock, SSHBlockMeta } from '@/blocks/blocks/ssh'
import { StagehandBlock, StagehandBlockMeta } from '@/blocks/blocks/stagehand'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { StripeBlock, StripeBlockMeta } from '@/blocks/blocks/stripe'
import { STSBlock, STSBlockMeta } from '@/blocks/blocks/sts'
import { SttBlock, SttV2Block } from '@/blocks/blocks/stt'
import { SupabaseBlock, SupabaseBlockMeta } from '@/blocks/blocks/supabase'
import { TableBlock } from '@/blocks/blocks/table'
import { TailscaleBlock, TailscaleBlockMeta } from '@/blocks/blocks/tailscale'
import { TavilyBlock, TavilyBlockMeta } from '@/blocks/blocks/tavily'
import { TelegramBlock, TelegramBlockMeta } from '@/blocks/blocks/telegram'
import { TemporalBlock, TemporalBlockMeta } from '@/blocks/blocks/temporal'
import { TextractBlock, TextractBlockMeta, TextractV2Block } from '@/blocks/blocks/textract'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { ThriveBlock, ThriveBlockMeta } from '@/blocks/blocks/thrive'
import { TikTokBlock, TikTokBlockMeta } from '@/blocks/blocks/tiktok'
import { TinybirdBlock, TinybirdBlockMeta } from '@/blocks/blocks/tinybird'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock, TrelloBlockMeta } from '@/blocks/blocks/trello'
import { TriggerDevBlock, TriggerDevBlockMeta } from '@/blocks/blocks/trigger_dev'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock, TwilioSMSBlockMeta } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock, TwilioVoiceBlockMeta } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock, TypeformBlockMeta } from '@/blocks/blocks/typeform'
import { UpstashBlock, UpstashBlockMeta } from '@/blocks/blocks/upstash'
import { UptimeRobotBlock, UptimeRobotBlockMeta } from '@/blocks/blocks/uptimerobot'
import { VantaBlock, VantaBlockMeta } from '@/blocks/blocks/vanta'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VercelBlock, VercelBlockMeta } from '@/blocks/blocks/vercel'
import {
  VideoGeneratorBlock,
  VideoGeneratorV2Block,
  VideoGeneratorV3Block,
} from '@/blocks/blocks/video_generator'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WealthboxBlock, WealthboxBlockMeta } from '@/blocks/blocks/wealthbox'
import { WebflowBlock, WebflowBlockMeta } from '@/blocks/blocks/webflow'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WhatsAppBlock, WhatsAppBlockMeta } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock, WikipediaBlockMeta } from '@/blocks/blocks/wikipedia'
import { WizaBlock, WizaBlockMeta } from '@/blocks/blocks/wiza'
import { WordPressBlock, WordPressBlockMeta } from '@/blocks/blocks/wordpress'
import { WorkdayBlock, WorkdayBlockMeta } from '@/blocks/blocks/workday'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { XBlock, XBlockMeta } from '@/blocks/blocks/x'
import { YouTubeBlock, YouTubeBlockMeta } from '@/blocks/blocks/youtube'
import { ZendeskBlock, ZendeskBlockMeta } from '@/blocks/blocks/zendesk'
import { ZepBlock, ZepBlockMeta } from '@/blocks/blocks/zep'
import { ZeroBounceBlock, ZeroBounceBlockMeta } from '@/blocks/blocks/zerobounce'
import { ZoomBlock, ZoomBlockMeta } from '@/blocks/blocks/zoom'
import { ZoomInfoBlock, ZoomInfoBlockMeta } from '@/blocks/blocks/zoominfo'
import type { BlockConfig, BlockMeta } from '@/blocks/types'

/** All block configs keyed by block type. The execution source of truth. */
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
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
  buffer: BufferBlock,
  calcom: CalComBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  clay: ClayBlock,
  clerk: ClerkBlock,
  clickhouse: ClickHouseBlock,
  clickup: ClickUpBlock,
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
  downdetector: DowndetectorBlock,
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
  flint: FlintBlock,
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
  google_appsheet: GoogleAppsheetBlock,
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
  grain_v2: GrainV2Block,
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
  instagram: InstagramBlock,
  instantly: InstantlyBlock,
  intercom: IntercomBlock,
  intercom_v2: IntercomV2Block,
  jina: JinaBlock,
  jira: JiraBlock,
  jira_service_management: JiraServiceManagementBlock,
  jupyter: JupyterBlock,
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
  managed_agent: ManagedAgentBlock,
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
  rocketlane: RocketlaneBlock,
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
  serpdive: SerpdiveBlock,
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
  slack_v2: SlackV2Block,
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
  tiktok: TikTokBlock,
  tinybird: TinybirdBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  trigger_dev: TriggerDevBlock,
  tts: TtsBlock,
  twilio_sms: TwilioSMSBlock,
  twilio_voice: TwilioVoiceBlock,
  typeform: TypeformBlock,
  upstash: UpstashBlock,
  uptimerobot: UptimeRobotBlock,
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
 * Block presentation/catalog metas (`{ tags, templates }`) keyed by block
 * type. Sibling to `BLOCK_REGISTRY`; pulled from the same block files so the
 * two stay in lockstep without a separate registry to maintain.
 *
 * `BlockMeta` exists only for catalog-visible integrations — every key here
 * has a corresponding entry in `lib/integrations/integrations.json`. Blocks
 * absent from the catalog (core blocks like `agent`/`api`, superseded base
 * versions, and hidden tools) carry no meta because the only consumers are
 * integration surfaces: `getTemplatesForBlock` (the two integration detail
 * pages) and `getAllBlockMeta()` → `POPULAR_WORKFLOWS` (landing integrations
 * index). The toolbar and search modal read block *configs*, not metas.
 */
export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {
  agentmail: AgentMailBlockMeta,
  agentphone: AgentPhoneBlockMeta,
  agiloft: AgiloftBlockMeta,
  ahrefs: AhrefsBlockMeta,
  airtable: AirtableBlockMeta,
  airweave: AirweaveBlockMeta,
  algolia: AlgoliaBlockMeta,
  amplitude: AmplitudeBlockMeta,
  apify: ApifyBlockMeta,
  appconfig: AppConfigBlockMeta,
  apollo: ApolloBlockMeta,
  arxiv: ArxivBlockMeta,
  asana: AsanaBlockMeta,
  ashby: AshbyBlockMeta,
  athena: AthenaBlockMeta,
  attio: AttioBlockMeta,
  azure_devops: AzureDevOpsBlockMeta,
  box: BoxBlockMeta,
  brandfetch: BrandfetchBlockMeta,
  brex: BrexBlockMeta,
  brightdata: BrightDataBlockMeta,
  browser_use: BrowserUseBlockMeta,
  buffer: BufferBlockMeta,
  calcom: CalComBlockMeta,
  calendly: CalendlyBlockMeta,
  circleback: CirclebackBlockMeta,
  clay: ClayBlockMeta,
  clerk: ClerkBlockMeta,
  clickhouse: ClickHouseBlockMeta,
  clickup: ClickUpBlockMeta,
  cloudflare: CloudflareBlockMeta,
  cloudformation: CloudFormationBlockMeta,
  cloudwatch: CloudWatchBlockMeta,
  codepipeline: CodePipelineBlockMeta,
  confluence: ConfluenceBlockMeta,
  context_dev: ContextDevBlockMeta,
  convex: ConvexBlockMeta,
  crowdstrike: CrowdStrikeBlockMeta,
  cursor: CursorBlockMeta,
  dagster: DagsterBlockMeta,
  databricks: DatabricksBlockMeta,
  datadog: DatadogBlockMeta,
  datagma: DatagmaBlockMeta,
  daytona: DaytonaBlockMeta,
  devin: DevinBlockMeta,
  discord: DiscordBlockMeta,
  docusign: DocuSignBlockMeta,
  downdetector: DowndetectorBlockMeta,
  dropbox: DropboxBlockMeta,
  dropcontact: DropcontactBlockMeta,
  dspy: DSPyBlockMeta,
  dub: DubBlockMeta,
  duckduckgo: DuckDuckGoBlockMeta,
  dynamodb: DynamoDBBlockMeta,
  elasticsearch: ElasticsearchBlockMeta,
  elevenlabs: ElevenLabsBlockMeta,
  emailbison: EmailBisonBlockMeta,
  enrich: EnrichBlockMeta,
  enrichment: EnrichmentBlockMeta,
  enrow: EnrowBlockMeta,
  evernote: EvernoteBlockMeta,
  exa: ExaBlockMeta,
  extend: ExtendBlockMeta,
  fathom: FathomBlockMeta,
  findymail: FindymailBlockMeta,
  firecrawl: FirecrawlBlockMeta,
  fireflies: FirefliesBlockMeta,
  fireflies_v2: FirefliesV2BlockMeta,
  flint: FlintBlockMeta,
  gamma: GammaBlockMeta,
  github: GitHubBlockMeta,
  github_v2: GitHubV2BlockMeta,
  gitlab: GitLabBlockMeta,
  gmail: GmailBlockMeta,
  gmail_v2: GmailV2BlockMeta,
  gong: GongBlockMeta,
  google_ads: GoogleAdsBlockMeta,
  google_appsheet: GoogleAppsheetBlockMeta,
  google_bigquery: GoogleBigQueryBlockMeta,
  google_books: GoogleBooksBlockMeta,
  google_calendar: GoogleCalendarBlockMeta,
  google_calendar_v2: GoogleCalendarV2BlockMeta,
  google_contacts: GoogleContactsBlockMeta,
  google_docs: GoogleDocsBlockMeta,
  google_drive: GoogleDriveBlockMeta,
  google_forms: GoogleFormsBlockMeta,
  google_groups: GoogleGroupsBlockMeta,
  google_maps: GoogleMapsBlockMeta,
  google_meet: GoogleMeetBlockMeta,
  google_pagespeed: GooglePagespeedBlockMeta,
  google_search: GoogleSearchBlockMeta,
  google_sheets: GoogleSheetsBlockMeta,
  google_sheets_v2: GoogleSheetsV2BlockMeta,
  google_slides: GoogleSlidesBlockMeta,
  google_slides_v2: GoogleSlidesV2BlockMeta,
  google_tasks: GoogleTasksBlockMeta,
  google_translate: GoogleTranslateBlockMeta,
  google_vault: GoogleVaultBlockMeta,
  grafana: GrafanaBlockMeta,
  grain: GrainBlockMeta,
  grain_v2: GrainV2BlockMeta,
  granola: GranolaBlockMeta,
  greenhouse: GreenhouseBlockMeta,
  greptile: GreptileBlockMeta,
  hex: HexBlockMeta,
  hubspot: HubSpotBlockMeta,
  huggingface: HuggingFaceBlockMeta,
  hunter: HunterBlockMeta,
  iam: IAMBlockMeta,
  icypeas: IcypeasBlockMeta,
  identity_center: IdentityCenterBlockMeta,
  imap: ImapBlockMeta,
  incidentio: IncidentioBlockMeta,
  infisical: InfisicalBlockMeta,
  instagram: InstagramBlockMeta,
  instantly: InstantlyBlockMeta,
  intercom: IntercomBlockMeta,
  intercom_v2: IntercomV2BlockMeta,
  jina: JinaBlockMeta,
  jira: JiraBlockMeta,
  jira_service_management: JiraServiceManagementBlockMeta,
  jupyter: JupyterBlockMeta,
  kalshi: KalshiBlockMeta,
  kalshi_v2: KalshiV2BlockMeta,
  ketch: KetchBlockMeta,
  langsmith: LangsmithBlockMeta,
  latex: LatexBlockMeta,
  launchdarkly: LaunchDarklyBlockMeta,
  leadmagic: LeadMagicBlockMeta,
  lemlist: LemlistBlockMeta,
  linear: LinearBlockMeta,
  linkedin: LinkedInBlockMeta,
  linkup: LinkupBlockMeta,
  linq: LinqBlockMeta,
  loops: LoopsBlockMeta,
  luma: LumaBlockMeta,
  mailchimp: MailchimpBlockMeta,
  mailgun: MailgunBlockMeta,
  managed_agent: ManagedAgentBlockMeta,
  mem0: Mem0BlockMeta,
  microsoft_ad: MicrosoftAdBlockMeta,
  microsoft_dataverse: MicrosoftDataverseBlockMeta,
  microsoft_excel: MicrosoftExcelBlockMeta,
  microsoft_excel_v2: MicrosoftExcelV2BlockMeta,
  microsoft_planner: MicrosoftPlannerBlockMeta,
  microsoft_teams: MicrosoftTeamsBlockMeta,
  millionverifier: MillionVerifierBlockMeta,
  mistral_parse: MistralParseBlockMeta,
  monday: MondayBlockMeta,
  mongodb: MongoDBBlockMeta,
  mysql: MySQLBlockMeta,
  neo4j: Neo4jBlockMeta,
  neverbounce: NeverBounceBlockMeta,
  new_relic: NewRelicBlockMeta,
  notion: NotionBlockMeta,
  notion_v2: NotionV2BlockMeta,
  obsidian: ObsidianBlockMeta,
  okta: OktaBlockMeta,
  onedrive: OneDriveBlockMeta,
  onepassword: OnePasswordBlockMeta,
  openai: OpenAIBlockMeta,
  outlook: OutlookBlockMeta,
  pagerduty: PagerDutyBlockMeta,
  parallel_ai: ParallelBlockMeta,
  peopledatalabs: PeopleDataLabsBlockMeta,
  perplexity: PerplexityBlockMeta,
  persona: PersonaBlockMeta,
  pinecone: PineconeBlockMeta,
  pipedrive: PipedriveBlockMeta,
  polymarket: PolymarketBlockMeta,
  postgresql: PostgreSQLBlockMeta,
  posthog: PostHogBlockMeta,
  profound: ProfoundBlockMeta,
  prospeo: ProspeoBlockMeta,
  pulse: PulseBlockMeta,
  qdrant: QdrantBlockMeta,
  quartr: QuartrBlockMeta,
  quiver: QuiverBlockMeta,
  railway: RailwayBlockMeta,
  rb2b: RB2BBlockMeta,
  rds: RDSBlockMeta,
  reddit: RedditBlockMeta,
  redis: RedisBlockMeta,
  reducto: ReductoBlockMeta,
  resend: ResendBlockMeta,
  revenuecat: RevenueCatBlockMeta,
  rippling: RipplingBlockMeta,
  rocketlane: RocketlaneBlockMeta,
  rootly: RootlyBlockMeta,
  rss: RssBlockMeta,
  s3: S3BlockMeta,
  salesforce: SalesforceBlockMeta,
  sap_concur: SapConcurBlockMeta,
  sap_s4hana: SapS4HanaBlockMeta,
  secrets_manager: SecretsManagerBlockMeta,
  sendblue: SendblueBlockMeta,
  sendgrid: SendGridBlockMeta,
  sentry: SentryBlockMeta,
  serpdive: SerpdiveBlockMeta,
  serper: SerperBlockMeta,
  servicenow: ServiceNowBlockMeta,
  ses: SESBlockMeta,
  sftp: SftpBlockMeta,
  sharepoint: SharepointBlockMeta,
  shopify: ShopifyBlockMeta,
  similarweb: SimilarwebBlockMeta,
  sixtyfour: SixtyfourBlockMeta,
  slack: SlackBlockMeta,
  smtp: SmtpBlockMeta,
  sportmonks: SportmonksBlockMeta,
  spotify: SpotifyBlockMeta,
  sqs: SQSBlockMeta,
  square: SquareBlockMeta,
  ssh: SSHBlockMeta,
  stagehand: StagehandBlockMeta,
  stripe: StripeBlockMeta,
  sts: STSBlockMeta,
  supabase: SupabaseBlockMeta,
  tailscale: TailscaleBlockMeta,
  tavily: TavilyBlockMeta,
  telegram: TelegramBlockMeta,
  temporal: TemporalBlockMeta,
  textract: TextractBlockMeta,
  thrive: ThriveBlockMeta,
  tiktok: TikTokBlockMeta,
  tinybird: TinybirdBlockMeta,
  trello: TrelloBlockMeta,
  trigger_dev: TriggerDevBlockMeta,
  twilio_sms: TwilioSMSBlockMeta,
  twilio_voice: TwilioVoiceBlockMeta,
  typeform: TypeformBlockMeta,
  upstash: UpstashBlockMeta,
  uptimerobot: UptimeRobotBlockMeta,
  vanta: VantaBlockMeta,
  vercel: VercelBlockMeta,
  wealthbox: WealthboxBlockMeta,
  webflow: WebflowBlockMeta,
  whatsapp: WhatsAppBlockMeta,
  wikipedia: WikipediaBlockMeta,
  wiza: WizaBlockMeta,
  wordpress: WordPressBlockMeta,
  workday: WorkdayBlockMeta,
  x: XBlockMeta,
  youtube: YouTubeBlockMeta,
  zendesk: ZendeskBlockMeta,
  zep: ZepBlockMeta,
  zerobounce: ZeroBounceBlockMeta,
  zoom: ZoomBlockMeta,
  zoominfo: ZoomInfoBlockMeta,
}