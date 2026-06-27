import { createLogger } from '@sim/logger'
import { stripVersionSuffix } from '@sim/utils/string'
import { BLOCK_CATALOG } from '@/blocks/manifest-data'
import type {
  BlockCategory,
  BlockConfig,
  BlockMeta,
  BlockTemplate,
  SuggestedSkill,
} from '@/blocks/types'

const logger = createLogger('BlockRegistry')

/**
 * Lazy loaders for every block config, keyed by block type. The full configs
 * (subBlocks/tools/inputs/outputs) are loaded on demand via dynamic import into
 * {@link blockCache}; display/catalog metadata lives in the registry-free
 * `@/blocks/manifest`. Callers that read a config synchronously
 * (`getBlock`/`getAllBlocks`) must first `await loadBlockConfigs([...])` for
 * the types they need — the canvas does this at workflow-open, the add-block
 * handlers per placement, and backend paths at their async entry.
 */
const BLOCK_LOADERS: Record<string, () => Promise<BlockConfig>> = {
  a2a: () => import('@/blocks/blocks/a2a').then((mod) => mod.A2ABlock),
  agent: () => import('@/blocks/blocks/agent').then((mod) => mod.AgentBlock),
  agentmail: () => import('@/blocks/blocks/agentmail').then((mod) => mod.AgentMailBlock),
  agentphone: () => import('@/blocks/blocks/agentphone').then((mod) => mod.AgentPhoneBlock),
  agiloft: () => import('@/blocks/blocks/agiloft').then((mod) => mod.AgiloftBlock),
  ahrefs: () => import('@/blocks/blocks/ahrefs').then((mod) => mod.AhrefsBlock),
  airtable: () => import('@/blocks/blocks/airtable').then((mod) => mod.AirtableBlock),
  airweave: () => import('@/blocks/blocks/airweave').then((mod) => mod.AirweaveBlock),
  algolia: () => import('@/blocks/blocks/algolia').then((mod) => mod.AlgoliaBlock),
  amplitude: () => import('@/blocks/blocks/amplitude').then((mod) => mod.AmplitudeBlock),
  api: () => import('@/blocks/blocks/api').then((mod) => mod.ApiBlock),
  api_trigger: () => import('@/blocks/blocks/api_trigger').then((mod) => mod.ApiTriggerBlock),
  apify: () => import('@/blocks/blocks/apify').then((mod) => mod.ApifyBlock),
  appconfig: () => import('@/blocks/blocks/appconfig').then((mod) => mod.AppConfigBlock),
  apollo: () => import('@/blocks/blocks/apollo').then((mod) => mod.ApolloBlock),
  arxiv: () => import('@/blocks/blocks/arxiv').then((mod) => mod.ArxivBlock),
  asana: () => import('@/blocks/blocks/asana').then((mod) => mod.AsanaBlock),
  ashby: () => import('@/blocks/blocks/ashby').then((mod) => mod.AshbyBlock),
  athena: () => import('@/blocks/blocks/athena').then((mod) => mod.AthenaBlock),
  attio: () => import('@/blocks/blocks/attio').then((mod) => mod.AttioBlock),
  azure_devops: () => import('@/blocks/blocks/azure_devops').then((mod) => mod.AzureDevOpsBlock),
  box: () => import('@/blocks/blocks/box').then((mod) => mod.BoxBlock),
  brandfetch: () => import('@/blocks/blocks/brandfetch').then((mod) => mod.BrandfetchBlock),
  brex: () => import('@/blocks/blocks/brex').then((mod) => mod.BrexBlock),
  brightdata: () => import('@/blocks/blocks/brightdata').then((mod) => mod.BrightDataBlock),
  browser_use: () => import('@/blocks/blocks/browser_use').then((mod) => mod.BrowserUseBlock),
  calcom: () => import('@/blocks/blocks/calcom').then((mod) => mod.CalComBlock),
  calendly: () => import('@/blocks/blocks/calendly').then((mod) => mod.CalendlyBlock),
  chat_trigger: () => import('@/blocks/blocks/chat_trigger').then((mod) => mod.ChatTriggerBlock),
  circleback: () => import('@/blocks/blocks/circleback').then((mod) => mod.CirclebackBlock),
  clay: () => import('@/blocks/blocks/clay').then((mod) => mod.ClayBlock),
  clerk: () => import('@/blocks/blocks/clerk').then((mod) => mod.ClerkBlock),
  clickhouse: () => import('@/blocks/blocks/clickhouse').then((mod) => mod.ClickHouseBlock),
  cloudflare: () => import('@/blocks/blocks/cloudflare').then((mod) => mod.CloudflareBlock),
  cloudformation: () =>
    import('@/blocks/blocks/cloudformation').then((mod) => mod.CloudFormationBlock),
  cloudwatch: () => import('@/blocks/blocks/cloudwatch').then((mod) => mod.CloudWatchBlock),
  codepipeline: () => import('@/blocks/blocks/codepipeline').then((mod) => mod.CodePipelineBlock),
  condition: () => import('@/blocks/blocks/condition').then((mod) => mod.ConditionBlock),
  confluence: () => import('@/blocks/blocks/confluence').then((mod) => mod.ConfluenceBlock),
  confluence_v2: () => import('@/blocks/blocks/confluence').then((mod) => mod.ConfluenceV2Block),
  context_dev: () => import('@/blocks/blocks/context_dev').then((mod) => mod.ContextDevBlock),
  convex: () => import('@/blocks/blocks/convex').then((mod) => mod.ConvexBlock),
  credential: () => import('@/blocks/blocks/credential').then((mod) => mod.CredentialBlock),
  crowdstrike: () => import('@/blocks/blocks/crowdstrike').then((mod) => mod.CrowdStrikeBlock),
  cursor: () => import('@/blocks/blocks/cursor').then((mod) => mod.CursorBlock),
  cursor_v2: () => import('@/blocks/blocks/cursor').then((mod) => mod.CursorV2Block),
  dagster: () => import('@/blocks/blocks/dagster').then((mod) => mod.DagsterBlock),
  databricks: () => import('@/blocks/blocks/databricks').then((mod) => mod.DatabricksBlock),
  datadog: () => import('@/blocks/blocks/datadog').then((mod) => mod.DatadogBlock),
  datagma: () => import('@/blocks/blocks/datagma').then((mod) => mod.DatagmaBlock),
  daytona: () => import('@/blocks/blocks/daytona').then((mod) => mod.DaytonaBlock),
  deployments: () => import('@/blocks/blocks/deployments').then((mod) => mod.DeploymentsBlock),
  devin: () => import('@/blocks/blocks/devin').then((mod) => mod.DevinBlock),
  discord: () => import('@/blocks/blocks/discord').then((mod) => mod.DiscordBlock),
  docusign: () => import('@/blocks/blocks/docusign').then((mod) => mod.DocuSignBlock),
  dropbox: () => import('@/blocks/blocks/dropbox').then((mod) => mod.DropboxBlock),
  dropcontact: () => import('@/blocks/blocks/dropcontact').then((mod) => mod.DropcontactBlock),
  dspy: () => import('@/blocks/blocks/dspy').then((mod) => mod.DSPyBlock),
  dub: () => import('@/blocks/blocks/dub').then((mod) => mod.DubBlock),
  duckduckgo: () => import('@/blocks/blocks/duckduckgo').then((mod) => mod.DuckDuckGoBlock),
  dynamodb: () => import('@/blocks/blocks/dynamodb').then((mod) => mod.DynamoDBBlock),
  elasticsearch: () =>
    import('@/blocks/blocks/elasticsearch').then((mod) => mod.ElasticsearchBlock),
  elevenlabs: () => import('@/blocks/blocks/elevenlabs').then((mod) => mod.ElevenLabsBlock),
  emailbison: () => import('@/blocks/blocks/emailbison').then((mod) => mod.EmailBisonBlock),
  enrich: () => import('@/blocks/blocks/enrich').then((mod) => mod.EnrichBlock),
  enrichment: () => import('@/blocks/blocks/enrichment').then((mod) => mod.EnrichmentBlock),
  enrow: () => import('@/blocks/blocks/enrow').then((mod) => mod.EnrowBlock),
  evaluator: () => import('@/blocks/blocks/evaluator').then((mod) => mod.EvaluatorBlock),
  evernote: () => import('@/blocks/blocks/evernote').then((mod) => mod.EvernoteBlock),
  exa: () => import('@/blocks/blocks/exa').then((mod) => mod.ExaBlock),
  extend: () => import('@/blocks/blocks/extend').then((mod) => mod.ExtendBlock),
  extend_v2: () => import('@/blocks/blocks/extend').then((mod) => mod.ExtendV2Block),
  fathom: () => import('@/blocks/blocks/fathom').then((mod) => mod.FathomBlock),
  file: () => import('@/blocks/blocks/file').then((mod) => mod.FileBlock),
  file_v2: () => import('@/blocks/blocks/file').then((mod) => mod.FileV2Block),
  file_v3: () => import('@/blocks/blocks/file').then((mod) => mod.FileV3Block),
  file_v4: () => import('@/blocks/blocks/file').then((mod) => mod.FileV4Block),
  file_v5: () => import('@/blocks/blocks/file').then((mod) => mod.FileV5Block),
  findymail: () => import('@/blocks/blocks/findymail').then((mod) => mod.FindymailBlock),
  zerobounce: () => import('@/blocks/blocks/zerobounce').then((mod) => mod.ZeroBounceBlock),
  neverbounce: () => import('@/blocks/blocks/neverbounce').then((mod) => mod.NeverBounceBlock),
  millionverifier: () =>
    import('@/blocks/blocks/millionverifier').then((mod) => mod.MillionVerifierBlock),
  firecrawl: () => import('@/blocks/blocks/firecrawl').then((mod) => mod.FirecrawlBlock),
  fireflies: () => import('@/blocks/blocks/fireflies').then((mod) => mod.FirefliesBlock),
  fireflies_v2: () => import('@/blocks/blocks/fireflies').then((mod) => mod.FirefliesV2Block),
  function: () => import('@/blocks/blocks/function').then((mod) => mod.FunctionBlock),
  gamma: () => import('@/blocks/blocks/gamma').then((mod) => mod.GammaBlock),
  generic_webhook: () =>
    import('@/blocks/blocks/generic_webhook').then((mod) => mod.GenericWebhookBlock),
  github: () => import('@/blocks/blocks/github').then((mod) => mod.GitHubBlock),
  github_v2: () => import('@/blocks/blocks/github').then((mod) => mod.GitHubV2Block),
  gitlab: () => import('@/blocks/blocks/gitlab').then((mod) => mod.GitLabBlock),
  gmail: () => import('@/blocks/blocks/gmail').then((mod) => mod.GmailBlock),
  gmail_v2: () => import('@/blocks/blocks/gmail').then((mod) => mod.GmailV2Block),
  gong: () => import('@/blocks/blocks/gong').then((mod) => mod.GongBlock),
  google_ads: () => import('@/blocks/blocks/google_ads').then((mod) => mod.GoogleAdsBlock),
  google_bigquery: () =>
    import('@/blocks/blocks/google_bigquery').then((mod) => mod.GoogleBigQueryBlock),
  google_books: () => import('@/blocks/blocks/google_books').then((mod) => mod.GoogleBooksBlock),
  google_calendar: () =>
    import('@/blocks/blocks/google_calendar').then((mod) => mod.GoogleCalendarBlock),
  google_calendar_v2: () =>
    import('@/blocks/blocks/google_calendar').then((mod) => mod.GoogleCalendarV2Block),
  google_contacts: () =>
    import('@/blocks/blocks/google_contacts').then((mod) => mod.GoogleContactsBlock),
  google_docs: () => import('@/blocks/blocks/google_docs').then((mod) => mod.GoogleDocsBlock),
  google_drive: () => import('@/blocks/blocks/google_drive').then((mod) => mod.GoogleDriveBlock),
  google_forms: () => import('@/blocks/blocks/google_forms').then((mod) => mod.GoogleFormsBlock),
  google_groups: () => import('@/blocks/blocks/google_groups').then((mod) => mod.GoogleGroupsBlock),
  google_maps: () => import('@/blocks/blocks/google_maps').then((mod) => mod.GoogleMapsBlock),
  google_meet: () => import('@/blocks/blocks/google_meet').then((mod) => mod.GoogleMeetBlock),
  google_pagespeed: () =>
    import('@/blocks/blocks/google_pagespeed').then((mod) => mod.GooglePagespeedBlock),
  google_search: () => import('@/blocks/blocks/google').then((mod) => mod.GoogleSearchBlock),
  google_sheets: () => import('@/blocks/blocks/google_sheets').then((mod) => mod.GoogleSheetsBlock),
  google_sheets_v2: () =>
    import('@/blocks/blocks/google_sheets').then((mod) => mod.GoogleSheetsV2Block),
  google_slides: () => import('@/blocks/blocks/google_slides').then((mod) => mod.GoogleSlidesBlock),
  google_slides_v2: () =>
    import('@/blocks/blocks/google_slides').then((mod) => mod.GoogleSlidesV2Block),
  google_tasks: () => import('@/blocks/blocks/google_tasks').then((mod) => mod.GoogleTasksBlock),
  google_translate: () =>
    import('@/blocks/blocks/google_translate').then((mod) => mod.GoogleTranslateBlock),
  google_vault: () => import('@/blocks/blocks/google_vault').then((mod) => mod.GoogleVaultBlock),
  grafana: () => import('@/blocks/blocks/grafana').then((mod) => mod.GrafanaBlock),
  grain: () => import('@/blocks/blocks/grain').then((mod) => mod.GrainBlock),
  granola: () => import('@/blocks/blocks/granola').then((mod) => mod.GranolaBlock),
  greenhouse: () => import('@/blocks/blocks/greenhouse').then((mod) => mod.GreenhouseBlock),
  greptile: () => import('@/blocks/blocks/greptile').then((mod) => mod.GreptileBlock),
  guardrails: () => import('@/blocks/blocks/guardrails').then((mod) => mod.GuardrailsBlock),
  hex: () => import('@/blocks/blocks/hex').then((mod) => mod.HexBlock),
  hubspot: () => import('@/blocks/blocks/hubspot').then((mod) => mod.HubSpotBlock),
  huggingface: () => import('@/blocks/blocks/huggingface').then((mod) => mod.HuggingFaceBlock),
  human_in_the_loop: () =>
    import('@/blocks/blocks/human_in_the_loop').then((mod) => mod.HumanInTheLoopBlock),
  hunter: () => import('@/blocks/blocks/hunter').then((mod) => mod.HunterBlock),
  iam: () => import('@/blocks/blocks/iam').then((mod) => mod.IAMBlock),
  icypeas: () => import('@/blocks/blocks/icypeas').then((mod) => mod.IcypeasBlock),
  identity_center: () =>
    import('@/blocks/blocks/identity_center').then((mod) => mod.IdentityCenterBlock),
  image_generator: () =>
    import('@/blocks/blocks/image_generator').then((mod) => mod.ImageGeneratorBlock),
  image_generator_v2: () =>
    import('@/blocks/blocks/image_generator').then((mod) => mod.ImageGeneratorV2Block),
  imap: () => import('@/blocks/blocks/imap').then((mod) => mod.ImapBlock),
  incidentio: () => import('@/blocks/blocks/incidentio').then((mod) => mod.IncidentioBlock),
  infisical: () => import('@/blocks/blocks/infisical').then((mod) => mod.InfisicalBlock),
  input_trigger: () => import('@/blocks/blocks/input_trigger').then((mod) => mod.InputTriggerBlock),
  instantly: () => import('@/blocks/blocks/instantly').then((mod) => mod.InstantlyBlock),
  intercom: () => import('@/blocks/blocks/intercom').then((mod) => mod.IntercomBlock),
  intercom_v2: () => import('@/blocks/blocks/intercom').then((mod) => mod.IntercomV2Block),
  jina: () => import('@/blocks/blocks/jina').then((mod) => mod.JinaBlock),
  jira: () => import('@/blocks/blocks/jira').then((mod) => mod.JiraBlock),
  jira_service_management: () =>
    import('@/blocks/blocks/jira_service_management').then((mod) => mod.JiraServiceManagementBlock),
  kalshi: () => import('@/blocks/blocks/kalshi').then((mod) => mod.KalshiBlock),
  kalshi_v2: () => import('@/blocks/blocks/kalshi').then((mod) => mod.KalshiV2Block),
  ketch: () => import('@/blocks/blocks/ketch').then((mod) => mod.KetchBlock),
  knowledge: () => import('@/blocks/blocks/knowledge').then((mod) => mod.KnowledgeBlock),
  langsmith: () => import('@/blocks/blocks/langsmith').then((mod) => mod.LangsmithBlock),
  latex: () => import('@/blocks/blocks/latex').then((mod) => mod.LatexBlock),
  launchdarkly: () => import('@/blocks/blocks/launchdarkly').then((mod) => mod.LaunchDarklyBlock),
  leadmagic: () => import('@/blocks/blocks/leadmagic').then((mod) => mod.LeadMagicBlock),
  lemlist: () => import('@/blocks/blocks/lemlist').then((mod) => mod.LemlistBlock),
  linear: () => import('@/blocks/blocks/linear').then((mod) => mod.LinearBlock),
  linear_v2: () => import('@/blocks/blocks/linear').then((mod) => mod.LinearV2Block),
  linkedin: () => import('@/blocks/blocks/linkedin').then((mod) => mod.LinkedInBlock),
  linkup: () => import('@/blocks/blocks/linkup').then((mod) => mod.LinkupBlock),
  linq: () => import('@/blocks/blocks/linq').then((mod) => mod.LinqBlock),
  logs: () => import('@/blocks/blocks/logs').then((mod) => mod.LogsBlock),
  logs_v2: () => import('@/blocks/blocks/logs').then((mod) => mod.LogsV2Block),
  loops: () => import('@/blocks/blocks/loops').then((mod) => mod.LoopsBlock),
  luma: () => import('@/blocks/blocks/luma').then((mod) => mod.LumaBlock),
  mailchimp: () => import('@/blocks/blocks/mailchimp').then((mod) => mod.MailchimpBlock),
  mailgun: () => import('@/blocks/blocks/mailgun').then((mod) => mod.MailgunBlock),
  manual_trigger: () =>
    import('@/blocks/blocks/manual_trigger').then((mod) => mod.ManualTriggerBlock),
  mcp: () => import('@/blocks/blocks/mcp').then((mod) => mod.McpBlock),
  mem0: () => import('@/blocks/blocks/mem0').then((mod) => mod.Mem0Block),
  memory: () => import('@/blocks/blocks/memory').then((mod) => mod.MemoryBlock),
  microsoft_ad: () => import('@/blocks/blocks/microsoft_ad').then((mod) => mod.MicrosoftAdBlock),
  microsoft_dataverse: () =>
    import('@/blocks/blocks/microsoft_dataverse').then((mod) => mod.MicrosoftDataverseBlock),
  microsoft_excel: () =>
    import('@/blocks/blocks/microsoft_excel').then((mod) => mod.MicrosoftExcelBlock),
  microsoft_excel_v2: () =>
    import('@/blocks/blocks/microsoft_excel').then((mod) => mod.MicrosoftExcelV2Block),
  microsoft_planner: () =>
    import('@/blocks/blocks/microsoft_planner').then((mod) => mod.MicrosoftPlannerBlock),
  microsoft_teams: () =>
    import('@/blocks/blocks/microsoft_teams').then((mod) => mod.MicrosoftTeamsBlock),
  mistral_parse: () => import('@/blocks/blocks/mistral_parse').then((mod) => mod.MistralParseBlock),
  mistral_parse_v2: () =>
    import('@/blocks/blocks/mistral_parse').then((mod) => mod.MistralParseV2Block),
  mistral_parse_v3: () =>
    import('@/blocks/blocks/mistral_parse').then((mod) => mod.MistralParseV3Block),
  monday: () => import('@/blocks/blocks/monday').then((mod) => mod.MondayBlock),
  mongodb: () => import('@/blocks/blocks/mongodb').then((mod) => mod.MongoDBBlock),
  mothership: () => import('@/blocks/blocks/mothership').then((mod) => mod.MothershipBlock),
  mysql: () => import('@/blocks/blocks/mysql').then((mod) => mod.MySQLBlock),
  neo4j: () => import('@/blocks/blocks/neo4j').then((mod) => mod.Neo4jBlock),
  new_relic: () => import('@/blocks/blocks/new_relic').then((mod) => mod.NewRelicBlock),
  note: () => import('@/blocks/blocks/note').then((mod) => mod.NoteBlock),
  notion: () => import('@/blocks/blocks/notion').then((mod) => mod.NotionBlock),
  notion_v2: () => import('@/blocks/blocks/notion').then((mod) => mod.NotionV2Block),
  obsidian: () => import('@/blocks/blocks/obsidian').then((mod) => mod.ObsidianBlock),
  okta: () => import('@/blocks/blocks/okta').then((mod) => mod.OktaBlock),
  onedrive: () => import('@/blocks/blocks/onedrive').then((mod) => mod.OneDriveBlock),
  onepassword: () => import('@/blocks/blocks/onepassword').then((mod) => mod.OnePasswordBlock),
  openai: () => import('@/blocks/blocks/openai').then((mod) => mod.OpenAIBlock),
  outlook: () => import('@/blocks/blocks/outlook').then((mod) => mod.OutlookBlock),
  pagerduty: () => import('@/blocks/blocks/pagerduty').then((mod) => mod.PagerDutyBlock),
  parallel_ai: () => import('@/blocks/blocks/parallel').then((mod) => mod.ParallelBlock),
  peopledatalabs: () =>
    import('@/blocks/blocks/peopledatalabs').then((mod) => mod.PeopleDataLabsBlock),
  perplexity: () => import('@/blocks/blocks/perplexity').then((mod) => mod.PerplexityBlock),
  persona: () => import('@/blocks/blocks/persona').then((mod) => mod.PersonaBlock),
  pi: () => import('@/blocks/blocks/pi').then((mod) => mod.PiBlock),
  pinecone: () => import('@/blocks/blocks/pinecone').then((mod) => mod.PineconeBlock),
  pipedrive: () => import('@/blocks/blocks/pipedrive').then((mod) => mod.PipedriveBlock),
  polymarket: () => import('@/blocks/blocks/polymarket').then((mod) => mod.PolymarketBlock),
  postgresql: () => import('@/blocks/blocks/postgresql').then((mod) => mod.PostgreSQLBlock),
  posthog: () => import('@/blocks/blocks/posthog').then((mod) => mod.PostHogBlock),
  profound: () => import('@/blocks/blocks/profound').then((mod) => mod.ProfoundBlock),
  prospeo: () => import('@/blocks/blocks/prospeo').then((mod) => mod.ProspeoBlock),
  pulse: () => import('@/blocks/blocks/pulse').then((mod) => mod.PulseBlock),
  pulse_v2: () => import('@/blocks/blocks/pulse').then((mod) => mod.PulseV2Block),
  qdrant: () => import('@/blocks/blocks/qdrant').then((mod) => mod.QdrantBlock),
  quartr: () => import('@/blocks/blocks/quartr').then((mod) => mod.QuartrBlock),
  quiver: () => import('@/blocks/blocks/quiver').then((mod) => mod.QuiverBlock),
  railway: () => import('@/blocks/blocks/railway').then((mod) => mod.RailwayBlock),
  rb2b: () => import('@/blocks/blocks/rb2b').then((mod) => mod.RB2BBlock),
  rds: () => import('@/blocks/blocks/rds').then((mod) => mod.RDSBlock),
  reddit: () => import('@/blocks/blocks/reddit').then((mod) => mod.RedditBlock),
  redis: () => import('@/blocks/blocks/redis').then((mod) => mod.RedisBlock),
  reducto: () => import('@/blocks/blocks/reducto').then((mod) => mod.ReductoBlock),
  reducto_v2: () => import('@/blocks/blocks/reducto').then((mod) => mod.ReductoV2Block),
  resend: () => import('@/blocks/blocks/resend').then((mod) => mod.ResendBlock),
  response: () => import('@/blocks/blocks/response').then((mod) => mod.ResponseBlock),
  revenuecat: () => import('@/blocks/blocks/revenuecat').then((mod) => mod.RevenueCatBlock),
  rippling: () => import('@/blocks/blocks/rippling').then((mod) => mod.RipplingBlock),
  rootly: () => import('@/blocks/blocks/rootly').then((mod) => mod.RootlyBlock),
  router: () => import('@/blocks/blocks/router').then((mod) => mod.RouterBlock),
  router_v2: () => import('@/blocks/blocks/router').then((mod) => mod.RouterV2Block),
  rss: () => import('@/blocks/blocks/rss').then((mod) => mod.RssBlock),
  s3: () => import('@/blocks/blocks/s3').then((mod) => mod.S3Block),
  salesforce: () => import('@/blocks/blocks/salesforce').then((mod) => mod.SalesforceBlock),
  sap_concur: () => import('@/blocks/blocks/sap_concur').then((mod) => mod.SapConcurBlock),
  sap_s4hana: () => import('@/blocks/blocks/sap_s4hana').then((mod) => mod.SapS4HanaBlock),
  schedule: () => import('@/blocks/blocks/schedule').then((mod) => mod.ScheduleBlock),
  search: () => import('@/blocks/blocks/search').then((mod) => mod.SearchBlock),
  secrets_manager: () =>
    import('@/blocks/blocks/secrets_manager').then((mod) => mod.SecretsManagerBlock),
  sendblue: () => import('@/blocks/blocks/sendblue').then((mod) => mod.SendblueBlock),
  sendgrid: () => import('@/blocks/blocks/sendgrid').then((mod) => mod.SendGridBlock),
  sentry: () => import('@/blocks/blocks/sentry').then((mod) => mod.SentryBlock),
  serper: () => import('@/blocks/blocks/serper').then((mod) => mod.SerperBlock),
  servicenow: () => import('@/blocks/blocks/servicenow').then((mod) => mod.ServiceNowBlock),
  ses: () => import('@/blocks/blocks/ses').then((mod) => mod.SESBlock),
  sftp: () => import('@/blocks/blocks/sftp').then((mod) => mod.SftpBlock),
  sharepoint: () => import('@/blocks/blocks/sharepoint').then((mod) => mod.SharepointBlock),
  sharepoint_v2: () => import('@/blocks/blocks/sharepoint').then((mod) => mod.SharepointV2Block),
  shopify: () => import('@/blocks/blocks/shopify').then((mod) => mod.ShopifyBlock),
  sim_workspace_event: () =>
    import('@/blocks/blocks/sim_workspace_event').then((mod) => mod.SimWorkspaceEventBlock),
  similarweb: () => import('@/blocks/blocks/similarweb').then((mod) => mod.SimilarwebBlock),
  sixtyfour: () => import('@/blocks/blocks/sixtyfour').then((mod) => mod.SixtyfourBlock),
  slack: () => import('@/blocks/blocks/slack').then((mod) => mod.SlackBlock),
  smtp: () => import('@/blocks/blocks/smtp').then((mod) => mod.SmtpBlock),
  sportmonks: () => import('@/blocks/blocks/sportmonks').then((mod) => mod.SportmonksBlock),
  spotify: () => import('@/blocks/blocks/spotify').then((mod) => mod.SpotifyBlock),
  sqs: () => import('@/blocks/blocks/sqs').then((mod) => mod.SQSBlock),
  square: () => import('@/blocks/blocks/square').then((mod) => mod.SquareBlock),
  ssh: () => import('@/blocks/blocks/ssh').then((mod) => mod.SSHBlock),
  stagehand: () => import('@/blocks/blocks/stagehand').then((mod) => mod.StagehandBlock),
  start_trigger: () => import('@/blocks/blocks/start_trigger').then((mod) => mod.StartTriggerBlock),
  starter: () => import('@/blocks/blocks/starter').then((mod) => mod.StarterBlock),
  stripe: () => import('@/blocks/blocks/stripe').then((mod) => mod.StripeBlock),
  sts: () => import('@/blocks/blocks/sts').then((mod) => mod.STSBlock),
  stt: () => import('@/blocks/blocks/stt').then((mod) => mod.SttBlock),
  stt_v2: () => import('@/blocks/blocks/stt').then((mod) => mod.SttV2Block),
  supabase: () => import('@/blocks/blocks/supabase').then((mod) => mod.SupabaseBlock),
  table: () => import('@/blocks/blocks/table').then((mod) => mod.TableBlock),
  tailscale: () => import('@/blocks/blocks/tailscale').then((mod) => mod.TailscaleBlock),
  tavily: () => import('@/blocks/blocks/tavily').then((mod) => mod.TavilyBlock),
  telegram: () => import('@/blocks/blocks/telegram').then((mod) => mod.TelegramBlock),
  temporal: () => import('@/blocks/blocks/temporal').then((mod) => mod.TemporalBlock),
  textract: () => import('@/blocks/blocks/textract').then((mod) => mod.TextractBlock),
  textract_v2: () => import('@/blocks/blocks/textract').then((mod) => mod.TextractV2Block),
  thinking: () => import('@/blocks/blocks/thinking').then((mod) => mod.ThinkingBlock),
  thrive: () => import('@/blocks/blocks/thrive').then((mod) => mod.ThriveBlock),
  tinybird: () => import('@/blocks/blocks/tinybird').then((mod) => mod.TinybirdBlock),
  translate: () => import('@/blocks/blocks/translate').then((mod) => mod.TranslateBlock),
  trello: () => import('@/blocks/blocks/trello').then((mod) => mod.TrelloBlock),
  trigger_dev: () => import('@/blocks/blocks/trigger_dev').then((mod) => mod.TriggerDevBlock),
  tts: () => import('@/blocks/blocks/tts').then((mod) => mod.TtsBlock),
  twilio_sms: () => import('@/blocks/blocks/twilio').then((mod) => mod.TwilioSMSBlock),
  twilio_voice: () => import('@/blocks/blocks/twilio_voice').then((mod) => mod.TwilioVoiceBlock),
  typeform: () => import('@/blocks/blocks/typeform').then((mod) => mod.TypeformBlock),
  upstash: () => import('@/blocks/blocks/upstash').then((mod) => mod.UpstashBlock),
  vanta: () => import('@/blocks/blocks/vanta').then((mod) => mod.VantaBlock),
  variables: () => import('@/blocks/blocks/variables').then((mod) => mod.VariablesBlock),
  vercel: () => import('@/blocks/blocks/vercel').then((mod) => mod.VercelBlock),
  video_generator: () =>
    import('@/blocks/blocks/video_generator').then((mod) => mod.VideoGeneratorBlock),
  video_generator_v2: () =>
    import('@/blocks/blocks/video_generator').then((mod) => mod.VideoGeneratorV2Block),
  video_generator_v3: () =>
    import('@/blocks/blocks/video_generator').then((mod) => mod.VideoGeneratorV3Block),
  vision: () => import('@/blocks/blocks/vision').then((mod) => mod.VisionBlock),
  vision_v2: () => import('@/blocks/blocks/vision').then((mod) => mod.VisionV2Block),
  wait: () => import('@/blocks/blocks/wait').then((mod) => mod.WaitBlock),
  wealthbox: () => import('@/blocks/blocks/wealthbox').then((mod) => mod.WealthboxBlock),
  webflow: () => import('@/blocks/blocks/webflow').then((mod) => mod.WebflowBlock),
  webhook_request: () =>
    import('@/blocks/blocks/webhook_request').then((mod) => mod.WebhookRequestBlock),
  whatsapp: () => import('@/blocks/blocks/whatsapp').then((mod) => mod.WhatsAppBlock),
  wikipedia: () => import('@/blocks/blocks/wikipedia').then((mod) => mod.WikipediaBlock),
  wiza: () => import('@/blocks/blocks/wiza').then((mod) => mod.WizaBlock),
  wordpress: () => import('@/blocks/blocks/wordpress').then((mod) => mod.WordPressBlock),
  workday: () => import('@/blocks/blocks/workday').then((mod) => mod.WorkdayBlock),
  workflow: () => import('@/blocks/blocks/workflow').then((mod) => mod.WorkflowBlock),
  workflow_input: () =>
    import('@/blocks/blocks/workflow_input').then((mod) => mod.WorkflowInputBlock),
  x: () => import('@/blocks/blocks/x').then((mod) => mod.XBlock),
  youtube: () => import('@/blocks/blocks/youtube').then((mod) => mod.YouTubeBlock),
  zendesk: () => import('@/blocks/blocks/zendesk').then((mod) => mod.ZendeskBlock),
  zep: () => import('@/blocks/blocks/zep').then((mod) => mod.ZepBlock),
  zoom: () => import('@/blocks/blocks/zoom').then((mod) => mod.ZoomBlock),
  zoominfo: () => import('@/blocks/blocks/zoominfo').then((mod) => mod.ZoomInfoBlock),
}

/** Configs resolved so far. Populated by {@link loadBlockConfigs}. */
const blockCache = new Map<string, BlockConfig>()

/**
 * Normalize an external block type to its registry key form: dashes become
 * underscores (some external sources use either form).
 */
function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

/** Resolve the loader key for a type, accepting the dash-form alias. */
function loaderKey(type: string): string | undefined {
  if (type in BLOCK_LOADERS) return type
  const normalized = normalizeType(type)
  return normalized in BLOCK_LOADERS ? normalized : undefined
}

/** Load a single block config into the cache (idempotent). */
export async function loadBlockConfig(type: string): Promise<BlockConfig | undefined> {
  const key = loaderKey(type)
  if (!key) return undefined
  const cached = blockCache.get(key)
  if (cached) return cached
  const config = await BLOCK_LOADERS[key]()
  blockCache.set(key, config)
  return config
}

/** Preload many block configs into the cache. Unknown types are ignored. */
export async function loadBlockConfigs(types: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(types)].map((type) => loadBlockConfig(type)))
}

/** Eagerly load every block config — for backend paths that genuinely need all. */
export async function loadAllBlockConfigs(): Promise<void> {
  await loadBlockConfigs(Object.keys(BLOCK_LOADERS))
}

/** Whether a block config has been loaded into the cache. */
export function isBlockLoaded(type: string): boolean {
  const key = loaderKey(type)
  return key ? blockCache.has(key) : false
}

/**
 * Get a loaded block config. Returns `undefined` if the type isn't preloaded;
 * in dev that's logged loudly (a missed preload) for known types.
 */
export function getBlock(type: string): BlockConfig | undefined {
  const config = blockCache.get(type) ?? blockCache.get(normalizeType(type))
  if (!config && process.env.NODE_ENV !== 'production' && loaderKey(type)) {
    logger.warn(
      `getBlock("${type}") called before its config was preloaded; call loadBlockConfigs([...]) at the async boundary first`
    )
  }
  return config
}

/** All loaded block configs. Callers needing every block must preload first (`loadAllBlockConfigs`). */
export function getAllBlocks(): BlockConfig[] {
  return [...blockCache.values()]
}

/** Find a loaded block whose `tools.access` contains the given tool id. */
export function getBlockByToolName(toolName: string): BlockConfig | undefined {
  return [...blockCache.values()].find((b) => b.tools?.access?.includes(toolName))
}

/**
 * Resolve the canonical (highest-version) block for a base type. Version keys
 * are known synchronously from the loader map; the config is read from the
 * cache (so the latest type must be preloaded).
 */
function resolveLatest(baseType: string): { type: string; config: BlockConfig } | undefined {
  const normalized = normalizeType(baseType)
  const versionPattern = new RegExp(`^${normalized}_v(\\d+)$`)
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of Object.keys(BLOCK_LOADERS)) {
    const match = key.match(versionPattern)
    if (!match) continue
    const version = Number.parseInt(match[1]!, 10)
    if (version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  if (latestKey) {
    const config = getBlock(latestKey)
    return config ? { type: latestKey, config } : undefined
  }
  const config = getBlock(normalized)
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

/** Loaded blocks in a given category. */
export function getBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return [...blockCache.values()].filter((block) => block.category === category)
}

/**
 * The canonical "latest-version, toolbar-visible" set of LOADED blocks for a
 * category. Display surfaces (toolbar, search, catalog) should use the
 * registry-free `getCanonicalBlockDisplayByCategory` from `@/blocks/manifest`
 * instead; this returns only configs already in the cache.
 */
export function getCanonicalBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return [...blockCache.values()].filter(
    (block) => block.category === category && !block.hideFromToolbar
  )
}

/** All registered block type identifiers (known without loading configs). */
export function getAllBlockTypes(): string[] {
  return Object.keys(BLOCK_LOADERS)
}

/** Whether the given string is a registered block type. Accepts hyphens as a dash-form alias. */
export function isValidBlockType(type: string): type is string {
  return loaderKey(type) !== undefined
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

export type { BlockCategory }
