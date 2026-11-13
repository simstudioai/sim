import { createBlock } from '@sim/testing/factories/block.factory'
import { blocksMock } from '@sim/testing/mocks/blocks.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTriggerModeSubBlock } from '@/lib/workflows/subblocks/visibility'
import * as blocks from '@/blocks'
import { AffinityBlock, AffinityV2Block } from '@/blocks/blocks/affinity'
import { AgentMailBlock, AgentMailV2Block } from '@/blocks/blocks/agentmail'
import { AgentPhoneBlock, AgentPhoneV2Block } from '@/blocks/blocks/agentphone'
import { AhrefsBlock, AhrefsV2Block } from '@/blocks/blocks/ahrefs'
import { AlgoliaBlock, AlgoliaV2Block } from '@/blocks/blocks/algolia'
import { AmplitudeBlock, AmplitudeV2Block } from '@/blocks/blocks/amplitude'
import { ApifyBlock, ApifyV2Block } from '@/blocks/blocks/apify'
import { ApolloBlock, ApolloV2Block } from '@/blocks/blocks/apollo'
import { AppConfigBlock, AppConfigV2Block } from '@/blocks/blocks/appconfig'
import { AshbyBlock, AshbyV2Block } from '@/blocks/blocks/ashby'
import { AthenaBlock, AthenaV2Block } from '@/blocks/blocks/athena'
import {
  AzureDataExplorerBlock,
  AzureDataExplorerV2Block,
} from '@/blocks/blocks/azure_data_explorer'
import { AzureDevOpsBlock, AzureDevOpsV2Block } from '@/blocks/blocks/azure_devops'
import { BrexBlock, BrexV2Block } from '@/blocks/blocks/brex'
import { BrightDataBlock, BrightDataV2Block } from '@/blocks/blocks/brightdata'
import { BrowserUseBlock, BrowserUseV2Block } from '@/blocks/blocks/browser_use'
import { BufferBlock, BufferV2Block } from '@/blocks/blocks/buffer'
import { CalendlyBlock, CalendlyV2Block } from '@/blocks/blocks/calendly'
import { CbInsightsBlock, CbInsightsV2Block } from '@/blocks/blocks/cbinsights'
import { CheckrBlock, CheckrV2Block } from '@/blocks/blocks/checkr'
import { CirclebackBlock, CirclebackV2Block } from '@/blocks/blocks/circleback'
import { ClerkBlock, ClerkV2Block } from '@/blocks/blocks/clerk'
import { CloudflareBlock, CloudflareV2Block } from '@/blocks/blocks/cloudflare'
import { CloudFormationBlock, CloudFormationV2Block } from '@/blocks/blocks/cloudformation'
import { CloudTrailBlock, CloudTrailV2Block } from '@/blocks/blocks/cloudtrail'
import { CloudWatchBlock, CloudWatchV2Block } from '@/blocks/blocks/cloudwatch'
import { CodePipelineBlock, CodePipelineV2Block } from '@/blocks/blocks/codepipeline'
import { ConvexBlock, ConvexV2Block } from '@/blocks/blocks/convex'
import { CrowdStrikeBlock, CrowdStrikeV2Block } from '@/blocks/blocks/crowdstrike'
import { CrunchbaseBlock, CrunchbaseV2Block } from '@/blocks/blocks/crunchbase'
import { CursorV2Block, CursorV3Block } from '@/blocks/blocks/cursor'
import { DatabricksBlock, DatabricksV2Block } from '@/blocks/blocks/databricks'
import { DatadogBlock, DatadogV2Block } from '@/blocks/blocks/datadog'
import { DaytonaBlock, DaytonaV2Block } from '@/blocks/blocks/daytona'
import { DevinBlock, DevinV2Block } from '@/blocks/blocks/devin'
import { DiscordBlock, DiscordV2Block } from '@/blocks/blocks/discord'
import { DubV2Block, DubV3Block } from '@/blocks/blocks/dub'
import { DynamoDBBlock, DynamoDBV2Block } from '@/blocks/blocks/dynamodb'
import { DynatraceBlock, DynatraceV2Block } from '@/blocks/blocks/dynatrace'
import { EC2Block, EC2V2Block } from '@/blocks/blocks/ec2'
import { ElevenLabsBlock, ElevenLabsV2Block } from '@/blocks/blocks/elevenlabs'
import { EmailBisonBlock, EmailBisonV2Block } from '@/blocks/blocks/emailbison'
import { EnrichBlock, EnrichV2Block } from '@/blocks/blocks/enrich'
import { ExtendV2Block, ExtendV3Block } from '@/blocks/blocks/extend'
import { FathomBlock, FathomV2Block } from '@/blocks/blocks/fathom'
import { FirefliesV2Block, FirefliesV3Block } from '@/blocks/blocks/fireflies'
import { FlintBlock, FlintV2Block } from '@/blocks/blocks/flint'
import { GammaBlock, GammaV2Block } from '@/blocks/blocks/gamma'
import { GitLabBlock, GitLabV2Block } from '@/blocks/blocks/gitlab'
import { GongBlock, GongV2Block } from '@/blocks/blocks/gong'
import { GrafanaBlock, GrafanaV2Block } from '@/blocks/blocks/grafana'
import { GrainV2Block, GrainV3Block } from '@/blocks/blocks/grain'
import { GranolaBlock, GranolaV2Block } from '@/blocks/blocks/granola'
import { HexBlock, HexV2Block } from '@/blocks/blocks/hex'
import { HuggingFaceBlock, HuggingFaceV2Block } from '@/blocks/blocks/huggingface'
import { IAMBlock, IAMV2Block } from '@/blocks/blocks/iam'
import { IdentityCenterBlock, IdentityCenterV2Block } from '@/blocks/blocks/identity_center'
import { IncidentioBlock, IncidentioV2Block } from '@/blocks/blocks/incidentio'
import { InfisicalBlock, InfisicalV2Block } from '@/blocks/blocks/infisical'
import { InstantlyBlock, InstantlyV2Block } from '@/blocks/blocks/instantly'
import { IntercomV2Block, IntercomV3Block } from '@/blocks/blocks/intercom'
import { JotformBlock, JotformV2Block } from '@/blocks/blocks/jotform'
import { JupyterV2Block, JupyterV3Block } from '@/blocks/blocks/jupyter'
import { KalshiV2Block, KalshiV3Block } from '@/blocks/blocks/kalshi'
import { LambdaBlock, LambdaV2Block } from '@/blocks/blocks/lambda'
import { LangsmithBlock, LangsmithV2Block } from '@/blocks/blocks/langsmith'
import { LaunchDarklyBlock, LaunchDarklyV2Block } from '@/blocks/blocks/launchdarkly'
import { LemlistBlock, LemlistV2Block } from '@/blocks/blocks/lemlist'
import { LinqBlock, LinqV2Block } from '@/blocks/blocks/linq'
import { LogfireBlock, LogfireV2Block } from '@/blocks/blocks/logfire'
import { LoopsBlock, LoopsV2Block } from '@/blocks/blocks/loops'
import { LumaBlock, LumaV2Block } from '@/blocks/blocks/luma'
import { MailchimpBlock, MailchimpV2Block } from '@/blocks/blocks/mailchimp'
import { MailgunBlock, MailgunV2Block } from '@/blocks/blocks/mailgun'
import { Mem0Block, Mem0V2Block } from '@/blocks/blocks/mem0'
import { MSSQLBlock, MSSQLV2Block } from '@/blocks/blocks/mssql'
import { MySQLBlock, MySQLV2Block } from '@/blocks/blocks/mysql'
import { NewRelicBlock, NewRelicV2Block } from '@/blocks/blocks/new_relic'
import { OktaBlock, OktaV2Block } from '@/blocks/blocks/okta'
import { OtterBlock, OtterV2Block } from '@/blocks/blocks/otter'
import { PagerDutyBlock, PagerDutyV2Block } from '@/blocks/blocks/pagerduty'
import { PersonaBlock, PersonaV2Block } from '@/blocks/blocks/persona'
import { PlaneBlock, PlaneV2Block } from '@/blocks/blocks/plane'
import { PlanetScaleBlock, PlanetScaleV2Block } from '@/blocks/blocks/planetscale'
import { PostgreSQLBlock, PostgreSQLV2Block } from '@/blocks/blocks/postgresql'
import { ProfoundBlock, ProfoundV2Block } from '@/blocks/blocks/profound'
import { PulseV2Block, PulseV3Block } from '@/blocks/blocks/pulse'
import { QdrantBlock, QdrantV2Block } from '@/blocks/blocks/qdrant'
import { QuartrBlock, QuartrV2Block } from '@/blocks/blocks/quartr'
import { QuiverV2Block, QuiverV3Block } from '@/blocks/blocks/quiver'
import { RailwayBlock, RailwayV2Block } from '@/blocks/blocks/railway'
import { RB2BBlock, RB2BV2Block } from '@/blocks/blocks/rb2b'
import { RDSBlock, RDSV2Block } from '@/blocks/blocks/rds'
import { ReductoV2Block, ReductoV3Block } from '@/blocks/blocks/reducto'
import { ResendBlock, ResendV2Block } from '@/blocks/blocks/resend'
import { RipplingBlock, RipplingV2Block } from '@/blocks/blocks/rippling'
import { RocketlaneBlock, RocketlaneV2Block } from '@/blocks/blocks/rocketlane'
import { RootlyBlock, RootlyV2Block } from '@/blocks/blocks/rootly'
import { S3Block, S3V2Block } from '@/blocks/blocks/s3'
import { SailPointBlock, SailPointV2Block } from '@/blocks/blocks/sailpoint'
import { SecretsManagerBlock, SecretsManagerV2Block } from '@/blocks/blocks/secrets_manager'
import { SendGridBlock, SendGridV2Block } from '@/blocks/blocks/sendgrid'
import { SentryBlock, SentryV2Block } from '@/blocks/blocks/sentry'
import { ServiceNowV2Block, ServiceNowV3Block } from '@/blocks/blocks/servicenow'
import { SESBlock, SESV2Block } from '@/blocks/blocks/ses'
import { SimilarwebBlock, SimilarwebV2Block } from '@/blocks/blocks/similarweb'
import { SixtyfourBlock, SixtyfourV2Block } from '@/blocks/blocks/sixtyfour'
import { SmartleadBlock, SmartleadV2Block } from '@/blocks/blocks/smartlead'
import { SplunkBlock, SplunkV2Block } from '@/blocks/blocks/splunk'
import { SportmonksBlock, SportmonksV2Block } from '@/blocks/blocks/sportmonks'
import { SQSBlock, SQSV2Block } from '@/blocks/blocks/sqs'
import { SquareBlock, SquareV2Block } from '@/blocks/blocks/square'
import { SSMBlock, SSMV2Block } from '@/blocks/blocks/ssm'
import { StripeBlock, StripeV2Block } from '@/blocks/blocks/stripe'
import { STSBlock, STSV2Block } from '@/blocks/blocks/sts'
import { SupabaseBlock, SupabaseV2Block } from '@/blocks/blocks/supabase'
import { TailscaleBlock, TailscaleV2Block } from '@/blocks/blocks/tailscale'
import { TavilyBlock, TavilyV2Block } from '@/blocks/blocks/tavily'
import { TelegramBlock, TelegramV2Block } from '@/blocks/blocks/telegram'
import { TextractBlock, TextractV2Block, TextractV3Block } from '@/blocks/blocks/textract'
import { ThriveBlock, ThriveV2Block } from '@/blocks/blocks/thrive'
import { TinybirdBlock, TinybirdV2Block } from '@/blocks/blocks/tinybird'
import { TriggerDevBlock, TriggerDevV2Block } from '@/blocks/blocks/trigger_dev'
import { TwilioSMSBlock, TwilioSMSV2Block } from '@/blocks/blocks/twilio'
import { TwilioVoiceBlock, TwilioVoiceV2Block } from '@/blocks/blocks/twilio_voice'
import { TypeformBlock, TypeformV2Block } from '@/blocks/blocks/typeform'
import { UpstashBlock, UpstashV2Block } from '@/blocks/blocks/upstash'
import { UptimeRobotBlock, UptimeRobotV2Block } from '@/blocks/blocks/uptimerobot'
import { VercelBlock, VercelV2Block } from '@/blocks/blocks/vercel'
import { WhatsAppBlock, WhatsAppV2Block } from '@/blocks/blocks/whatsapp'
import { YouComBlock, YouComV2Block } from '@/blocks/blocks/youcom'
import { YouTubeBlock, YouTubeV2Block } from '@/blocks/blocks/youtube'
import { ZendeskBlock, ZendeskV2Block } from '@/blocks/blocks/zendesk'
import { ZepBlock, ZepV2Block } from '@/blocks/blocks/zep'
import { ZoomInfoBlock, ZoomInfoV2Block } from '@/blocks/blocks/zoominfo'
import type { BlockConfig } from '@/blocks/types'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getSubBlocksForToolInput } from '@/tools/params'

vi.mock('@/blocks', () => blocksMock)
// Required-field validation reads the tools' real param declarations.
vi.unmock('@/tools/metadata')

/**
 * Each legacy block that takes inline secrets, and the credential-only version
 * that succeeds it. Legacy blocks keep running exactly as they always did; the
 * successor takes only a saved credential.
 */
const VERSIONS: Array<{
  legacy: BlockConfig
  successor: BlockConfig
  secretIds: readonly string[]
  /** Replaced connection fields the legacy block never required (a host defaulting to the vendor's). */
  optionalIds?: readonly string[]
  /** An operation that shows every replaced field, for a legacy block that shows some only there. */
  legacyOperation?: string
}> = [
  {
    legacy: AppConfigBlock,
    successor: AppConfigV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: AthenaBlock,
    successor: AthenaV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudFormationBlock,
    successor: CloudFormationV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudTrailBlock,
    successor: CloudTrailV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudWatchBlock,
    successor: CloudWatchV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CodePipelineBlock,
    successor: CodePipelineV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  { legacy: DatabricksBlock, successor: DatabricksV2Block, secretIds: ['host', 'apiKey'] },
  {
    legacy: DynamoDBBlock,
    successor: DynamoDBV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: EC2Block, successor: EC2V2Block, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { legacy: IAMBlock, successor: IAMV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: IdentityCenterBlock,
    successor: IdentityCenterV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: LambdaBlock,
    successor: LambdaV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  { legacy: RDSBlock, successor: RDSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: S3Block, successor: S3V2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: SecretsManagerBlock,
    successor: SecretsManagerV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: SESBlock, successor: SESV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: SQSBlock, successor: SQSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: SSMBlock, successor: SSMV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: STSBlock, successor: STSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: TextractBlock,
    successor: TextractV3Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: TextractV2Block,
    successor: TextractV3Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: TavilyBlock, successor: TavilyV2Block, secretIds: ['apiKey'] },
  { legacy: AffinityBlock, successor: AffinityV2Block, secretIds: ['apiKey'] },
  { legacy: AgentMailBlock, successor: AgentMailV2Block, secretIds: ['apiKey'] },
  { legacy: AgentPhoneBlock, successor: AgentPhoneV2Block, secretIds: ['apiKey'] },
  { legacy: AhrefsBlock, successor: AhrefsV2Block, secretIds: ['apiKey'] },
  { legacy: ApifyBlock, successor: ApifyV2Block, secretIds: ['apiKey'] },
  { legacy: ApolloBlock, successor: ApolloV2Block, secretIds: ['apiKey'] },
  { legacy: BrexBlock, successor: BrexV2Block, secretIds: ['apiKey'] },
  { legacy: BrightDataBlock, successor: BrightDataV2Block, secretIds: ['apiKey'] },
  { legacy: BrowserUseBlock, successor: BrowserUseV2Block, secretIds: ['apiKey'] },
  { legacy: BufferBlock, successor: BufferV2Block, secretIds: ['apiKey'] },
  { legacy: CirclebackBlock, successor: CirclebackV2Block, secretIds: ['apiKey'] },
  { legacy: ClerkBlock, successor: ClerkV2Block, secretIds: ['secretKey'] },
  { legacy: CloudflareBlock, successor: CloudflareV2Block, secretIds: ['apiKey'] },
  { legacy: CrunchbaseBlock, successor: CrunchbaseV2Block, secretIds: ['apiKey'] },
  { legacy: DaytonaBlock, successor: DaytonaV2Block, secretIds: ['apiKey'] },
  { legacy: ElevenLabsBlock, successor: ElevenLabsV2Block, secretIds: ['apiKey'] },
  { legacy: EnrichBlock, successor: EnrichV2Block, secretIds: ['apiKey'] },
  { legacy: GammaBlock, successor: GammaV2Block, secretIds: ['apiKey'] },
  { legacy: HexBlock, successor: HexV2Block, secretIds: ['apiKey'] },
  { legacy: HuggingFaceBlock, successor: HuggingFaceV2Block, secretIds: ['apiKey'] },
  { legacy: IncidentioBlock, successor: IncidentioV2Block, secretIds: ['apiKey'] },
  { legacy: InstantlyBlock, successor: InstantlyV2Block, secretIds: ['apiKey'] },
  { legacy: LangsmithBlock, successor: LangsmithV2Block, secretIds: ['apiKey'] },
  { legacy: LaunchDarklyBlock, successor: LaunchDarklyV2Block, secretIds: ['apiKey'] },
  { legacy: LinqBlock, successor: LinqV2Block, secretIds: ['apiKey'] },
  { legacy: LoopsBlock, successor: LoopsV2Block, secretIds: ['apiKey'] },
  { legacy: LumaBlock, successor: LumaV2Block, secretIds: ['apiKey'] },
  { legacy: MailchimpBlock, successor: MailchimpV2Block, secretIds: ['apiKey'] },
  { legacy: OtterBlock, successor: OtterV2Block, secretIds: ['apiKey'] },
  { legacy: PersonaBlock, successor: PersonaV2Block, secretIds: ['apiKey'] },
  { legacy: ProfoundBlock, successor: ProfoundV2Block, secretIds: ['apiKey'] },
  { legacy: QuartrBlock, successor: QuartrV2Block, secretIds: ['apiKey'] },
  { legacy: RB2BBlock, successor: RB2BV2Block, secretIds: ['apiKey'] },
  { legacy: RipplingBlock, successor: RipplingV2Block, secretIds: ['apiKey'] },
  { legacy: RocketlaneBlock, successor: RocketlaneV2Block, secretIds: ['apiKey'] },
  { legacy: SendGridBlock, successor: SendGridV2Block, secretIds: ['apiKey'] },
  { legacy: SimilarwebBlock, successor: SimilarwebV2Block, secretIds: ['apiKey'] },
  { legacy: SixtyfourBlock, successor: SixtyfourV2Block, secretIds: ['apiKey'] },
  { legacy: SmartleadBlock, successor: SmartleadV2Block, secretIds: ['apiKey'] },
  { legacy: SportmonksBlock, successor: SportmonksV2Block, secretIds: ['apiKey'] },
  { legacy: SquareBlock, successor: SquareV2Block, secretIds: ['apiKey'] },
  { legacy: TailscaleBlock, successor: TailscaleV2Block, secretIds: ['apiKey'] },
  { legacy: TriggerDevBlock, successor: TriggerDevV2Block, secretIds: ['apiKey'] },
  { legacy: UptimeRobotBlock, successor: UptimeRobotV2Block, secretIds: ['apiKey'] },
  { legacy: YouComBlock, successor: YouComV2Block, secretIds: ['apiKey'] },
  { legacy: YouTubeBlock, successor: YouTubeV2Block, secretIds: ['apiKey'] },
  { legacy: Mem0Block, successor: Mem0V2Block, secretIds: ['apiKey'] },
  { legacy: ZepBlock, successor: ZepV2Block, secretIds: ['apiKey'] },
  { legacy: DiscordBlock, successor: DiscordV2Block, secretIds: ['botToken'] },
  { legacy: CursorV2Block, successor: CursorV3Block, secretIds: ['apiKey'] },
  { legacy: DubV2Block, successor: DubV3Block, secretIds: ['apiKey'] },
  { legacy: ExtendV2Block, successor: ExtendV3Block, secretIds: ['apiKey'] },
  { legacy: FirefliesV2Block, successor: FirefliesV3Block, secretIds: ['apiKey'] },
  { legacy: IntercomV2Block, successor: IntercomV3Block, secretIds: ['accessToken'] },
  { legacy: PulseV2Block, successor: PulseV3Block, secretIds: ['apiKey'] },
  { legacy: QuiverV2Block, successor: QuiverV3Block, secretIds: ['apiKey'] },
  { legacy: ReductoV2Block, successor: ReductoV3Block, secretIds: ['apiKey'] },
  { legacy: FlintBlock, successor: FlintV2Block, secretIds: ['apiKey'] },
  { legacy: AshbyBlock, successor: AshbyV2Block, secretIds: ['apiKey'] },
  { legacy: CalendlyBlock, successor: CalendlyV2Block, secretIds: ['apiKey'] },
  { legacy: CheckrBlock, successor: CheckrV2Block, secretIds: ['apiKey'] },
  { legacy: FathomBlock, successor: FathomV2Block, secretIds: ['apiKey'] },
  { legacy: GrainV2Block, successor: GrainV3Block, secretIds: ['apiKey'] },
  { legacy: GranolaBlock, successor: GranolaV2Block, secretIds: ['apiKey'] },
  { legacy: LemlistBlock, successor: LemlistV2Block, secretIds: ['apiKey'] },
  { legacy: PagerDutyBlock, successor: PagerDutyV2Block, secretIds: ['apiKey'] },
  { legacy: ResendBlock, successor: ResendV2Block, secretIds: ['resendApiKey'] },
  { legacy: RootlyBlock, successor: RootlyV2Block, secretIds: ['apiKey'] },
  { legacy: SentryBlock, successor: SentryV2Block, secretIds: ['apiKey'] },
  { legacy: StripeBlock, successor: StripeV2Block, secretIds: ['apiKey'] },
  { legacy: TelegramBlock, successor: TelegramV2Block, secretIds: ['botToken'] },
  { legacy: TypeformBlock, successor: TypeformV2Block, secretIds: ['apiKey'] },
  { legacy: VercelBlock, successor: VercelV2Block, secretIds: ['apiKey'] },
  { legacy: WhatsAppBlock, successor: WhatsAppV2Block, secretIds: ['accessToken'] },
  {
    legacy: GitLabBlock,
    successor: GitLabV2Block,
    secretIds: ['accessToken', 'host'],
    optionalIds: ['host'],
  },
  { legacy: GrafanaBlock, successor: GrafanaV2Block, secretIds: ['baseUrl', 'apiKey'] },
  { legacy: JupyterV2Block, successor: JupyterV3Block, secretIds: ['serverUrl', 'token'] },
  { legacy: ConvexBlock, successor: ConvexV2Block, secretIds: ['deploymentUrl', 'deployKey'] },
  { legacy: TinybirdBlock, successor: TinybirdV2Block, secretIds: ['token', 'base_url'] },
  {
    legacy: DynatraceBlock,
    successor: DynatraceV2Block,
    secretIds: ['apiToken', 'environmentUrl'],
  },
  {
    legacy: NewRelicBlock,
    successor: NewRelicV2Block,
    secretIds: ['apiKey', 'region'],
    optionalIds: ['region'],
  },
  {
    legacy: LogfireBlock,
    successor: LogfireV2Block,
    secretIds: ['apiKey', 'host', 'region'],
    optionalIds: ['host', 'region'],
  },
  {
    legacy: MailgunBlock,
    successor: MailgunV2Block,
    secretIds: ['apiKey', 'region'],
    optionalIds: ['region'],
  },
  {
    legacy: JotformBlock,
    successor: JotformV2Block,
    secretIds: ['apiKey', 'region'],
    optionalIds: ['region'],
  },
  {
    legacy: PlaneBlock,
    successor: PlaneV2Block,
    secretIds: ['apiKey', 'baseUrl'],
    optionalIds: ['baseUrl'],
  },
  {
    legacy: AzureDataExplorerBlock,
    successor: AzureDataExplorerV2Block,
    secretIds: ['tenantId', 'clientId', 'clientSecret'],
  },
  {
    legacy: AzureDevOpsBlock,
    successor: AzureDevOpsV2Block,
    secretIds: ['accessToken', 'organization'],
    optionalIds: ['organization'],
  },
  { legacy: TwilioSMSBlock, successor: TwilioSMSV2Block, secretIds: ['accountSid', 'authToken'] },
  {
    legacy: TwilioVoiceBlock,
    successor: TwilioVoiceV2Block,
    secretIds: ['accountSid', 'authToken'],
  },
  { legacy: AlgoliaBlock, successor: AlgoliaV2Block, secretIds: ['applicationId', 'apiKey'] },
  { legacy: UpstashBlock, successor: UpstashV2Block, secretIds: ['restUrl', 'restToken'] },
  { legacy: EmailBisonBlock, successor: EmailBisonV2Block, secretIds: ['apiKey'] },
  { legacy: DevinBlock, successor: DevinV2Block, secretIds: ['apiKey'] },
  {
    legacy: ZendeskBlock,
    successor: ZendeskV2Block,
    secretIds: ['email', 'apiToken', 'subdomain'],
  },
  { legacy: OktaBlock, successor: OktaV2Block, secretIds: ['apiKey'] },
  {
    legacy: ZoomInfoBlock,
    successor: ZoomInfoV2Block,
    secretIds: ['clientId', 'clientSecret'],
  },
  {
    legacy: SailPointBlock,
    successor: SailPointV2Block,
    secretIds: ['tenant', 'clientId', 'clientSecret'],
  },
  {
    legacy: DatadogBlock,
    successor: DatadogV2Block,
    secretIds: ['apiKey', 'applicationKey', 'site'],
    optionalIds: ['applicationKey', 'site'],
    legacyOperation: 'datadog_get_monitor',
  },
  {
    legacy: CrowdStrikeBlock,
    successor: CrowdStrikeV2Block,
    secretIds: ['clientId', 'clientSecret', 'cloud'],
    optionalIds: ['cloud'],
  },
  {
    legacy: InfisicalBlock,
    successor: InfisicalV2Block,
    secretIds: ['apiKey', 'baseUrl'],
    optionalIds: ['baseUrl'],
  },
  { legacy: SupabaseBlock, successor: SupabaseV2Block, secretIds: ['apiKey', 'projectId'] },
  {
    legacy: ThriveBlock,
    successor: ThriveV2Block,
    secretIds: ['tenantId', 'apiKey', 'host'],
    optionalIds: ['host'],
  },
  {
    legacy: PlanetScaleBlock,
    successor: PlanetScaleV2Block,
    secretIds: ['serviceTokenId', 'serviceToken'],
  },
  { legacy: GongBlock, successor: GongV2Block, secretIds: ['accessKey', 'accessKeySecret'] },
  {
    legacy: QdrantBlock,
    successor: QdrantV2Block,
    secretIds: ['url', 'apiKey'],
    optionalIds: ['apiKey'],
    legacyOperation: 'upsert',
  },
  {
    legacy: RailwayBlock,
    successor: RailwayV2Block,
    secretIds: ['apiKey', 'tokenType'],
    optionalIds: ['tokenType'],
  },
  {
    legacy: CbInsightsBlock,
    successor: CbInsightsV2Block,
    secretIds: ['clientId', 'clientSecret'],
  },
  {
    legacy: SplunkBlock,
    successor: SplunkV2Block,
    secretIds: ['baseUrl', 'authToken', 'username', 'password'],
    optionalIds: ['authToken', 'username', 'password'],
  },
  {
    legacy: AmplitudeBlock,
    successor: AmplitudeV2Block,
    secretIds: ['apiKey', 'secretKey', 'dataResidency'],
    optionalIds: ['secretKey', 'dataResidency'],
    legacyOperation: 'list_events',
  },
  {
    legacy: ServiceNowV2Block,
    successor: ServiceNowV3Block,
    secretIds: ['instanceUrl', 'username', 'password'],
  },
  {
    legacy: PostgreSQLBlock,
    successor: PostgreSQLV2Block,
    secretIds: ['host', 'port', 'database', 'username', 'password', 'ssl'],
    optionalIds: ['port', 'ssl'],
  },
  {
    legacy: MySQLBlock,
    successor: MySQLV2Block,
    secretIds: ['host', 'port', 'database', 'username', 'password', 'ssl'],
    optionalIds: ['port', 'database', 'ssl'],
  },
  {
    legacy: MSSQLBlock,
    successor: MSSQLV2Block,
    secretIds: [
      'host',
      'port',
      'database',
      'username',
      'password',
      'encrypt',
      'trustServerCertificate',
    ],
    optionalIds: ['port', 'encrypt', 'trustServerCertificate'],
  },
]

function valuesFor(ids: readonly string[], prefix: string): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, `${prefix}-${id}`]))
}

/** Every operation, or the single default when a block has no operation dropdown. */
function operations(config: BlockConfig): (string | undefined)[] {
  const operation = config.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const options =
    typeof operation?.options === 'function' ? operation.options() : operation?.options
  const ids = options?.map((option) => option.id) ?? []
  return ids.length > 0 ? ids : [undefined]
}

function firstOperation(config: BlockConfig): string | undefined {
  return operations(config)[0]
}

/** One title per field id: a field repeated per operation (Qdrant's URL) is still one field. */
function fieldTitles(config: BlockConfig, ids: readonly string[]): string[] {
  const titles = new Map<string, string>()
  for (const subBlock of config.subBlocks) {
    if (!ids.includes(subBlock.id) || isTriggerModeSubBlock(subBlock)) continue
    if (!titles.has(subBlock.id)) titles.set(subBlock.id, subBlock.title ?? subBlock.id)
  }
  return [...titles.values()]
}

function buildBlock(config: BlockConfig, values: Record<string, string>): BlockState {
  const operation = firstOperation(config)
  const all: Record<string, string> = { ...(operation ? { operation } : {}), ...values }
  return createBlock({
    type: config.type,
    name: config.name,
    subBlocks: Object.fromEntries(
      Object.entries(all).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
  })
}

function serialize(block: BlockState) {
  return new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, false).blocks[0]
    .config.params
}

function missingRequiredFields(block: BlockState): string {
  try {
    new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, true)
    return ''
  } catch (error) {
    return getErrorMessage(error, String(error))
  }
}

describe.each(VERSIONS)(
  '$legacy.type legacy block',
  ({ legacy, secretIds, optionalIds = [], legacyOperation }) => {
    beforeEach(() => {
      vi.spyOn(blocks, 'getBlock').mockReturnValue(legacy)
    })

    it('serializes its inline secrets exactly as before', () => {
      const params = serialize(
        buildBlock(legacy, {
          ...(legacyOperation ? { operation: legacyOperation } : {}),
          ...valuesFor(secretIds, 'inline'),
        })
      )

      for (const id of secretIds) expect(params[id]).toBe(`inline-${id}`)
      expect(params.oauthCredential).toBeUndefined()
    })

    it('still requires its inline secrets', () => {
      const requiredIds = secretIds.filter((id) => !optionalIds.includes(id))
      const message = missingRequiredFields(buildBlock(legacy, {}))
      const titles = fieldTitles(legacy, requiredIds)

      expect(titles).toHaveLength(requiredIds.length)
      for (const title of titles) expect(message).toContain(title)
    })
  }
)

describe.each(VERSIONS)('$successor.type credential-only block', ({ successor, secretIds }) => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(successor)
  })

  it('requires a saved credential', () => {
    const message = missingRequiredFields(buildBlock(successor, {}))

    expect(message).toContain(fieldTitles(successor, ['credential'])[0])
  })

  it('passes validation with only a saved credential, in every operation', () => {
    for (const operation of operations(successor)) {
      const message = missingRequiredFields(
        buildBlock(successor, { ...(operation ? { operation } : {}), credential: 'cred-1' })
      )

      for (const id of secretIds) expect(message, operation).not.toContain(id)
    }
  })

  it('never offers inline secret fields when used as an agent tool', () => {
    for (const toolId of successor.tools.access) {
      const fields =
        getSubBlocksForToolInput(toolId, successor.type, undefined, undefined, successor)
          ?.subBlocks ?? []
      expect(fields.length, toolId).toBeGreaterThan(0)
      const ids = fields.map((field) => field.id)

      for (const id of secretIds) expect(ids, toolId).not.toContain(id)
    }
  })

  it('sends the saved credential and never inline secrets left in its state', () => {
    const params = serialize(
      buildBlock(successor, {
        credential: 'cred-1',
        ...valuesFor(secretIds, 'stale'),
      })
    )

    expect(params.oauthCredential).toBe('cred-1')
    for (const id of secretIds) expect(params[id]).toBeUndefined()
  })

  it('builds tool params without asking for inline secrets, in every operation', () => {
    for (const operation of operations(successor)) {
      const params = serialize(
        buildBlock(successor, { ...(operation ? { operation } : {}), credential: 'cred-1' })
      )
      let message = ''
      try {
        successor.tools.config?.params?.(params)
      } catch (error) {
        message = getErrorMessage(error, String(error))
      }

      // Operation fields left empty here may fail; a missing secret must not.
      expect(message, operation).not.toMatch(
        /access key|secret access|api key|token is required|host is required|cannot read properties of undefined/i
      )
    }
  })
})

describe('kalshi_v3 signed and public calls', () => {
  const SECRET_IDS = ['keyId', 'privateKey']

  it('kalshi_v2 still serializes its inline key for signed calls', () => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(KalshiV2Block)
    const params = serialize(
      buildBlock(KalshiV2Block, { operation: 'get_balance', ...valuesFor(SECRET_IDS, 'inline') })
    )

    for (const id of SECRET_IDS) expect(params[id]).toBe(`inline-${id}`)
    expect(params.oauthCredential).toBeUndefined()
  })

  it('requires a saved credential for signed calls only', () => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(KalshiV3Block)
    const credentialTitle = fieldTitles(KalshiV3Block, ['credential'])[0]

    expect(
      missingRequiredFields(buildBlock(KalshiV3Block, { operation: 'get_balance' }))
    ).toContain(credentialTitle)
    expect(
      missingRequiredFields(buildBlock(KalshiV3Block, { operation: 'get_markets' }))
    ).not.toContain(credentialTitle)
  })

  it('sends the saved credential and never inline secrets left in its state', () => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(KalshiV3Block)
    const params = serialize(
      buildBlock(KalshiV3Block, {
        operation: 'create_order',
        credential: 'cred-1',
        ...valuesFor(SECRET_IDS, 'stale'),
      })
    )

    expect(params.oauthCredential).toBe('cred-1')
    for (const id of SECRET_IDS) expect(params[id]).toBeUndefined()
  })

  it('never asks for the inline key, in any operation', () => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(KalshiV3Block)
    for (const operation of operations(KalshiV3Block)) {
      const message = missingRequiredFields(
        buildBlock(KalshiV3Block, { operation: operation ?? '', credential: 'cred-1' })
      )

      for (const id of SECRET_IDS) expect(message, operation).not.toContain(id)
    }
  })
})

describe('sts_v2 unsigned calls', () => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(STSV2Block)
  })

  it.each(['assume_role_with_web_identity', 'assume_role_with_saml'])(
    'runs %s without a saved credential',
    (operation) => {
      const message = missingRequiredFields(buildBlock(STSV2Block, { operation }))

      expect(message).not.toContain(fieldTitles(STSV2Block, ['credential'])[0])
    }
  )

  it('still requires a credential for signed calls', () => {
    const message = missingRequiredFields(
      buildBlock(STSV2Block, { operation: 'get_caller_identity' })
    )

    expect(message).toContain(fieldTitles(STSV2Block, ['credential'])[0])
  })
})

describe('discord_v2 webhook calls', () => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(DiscordV2Block)
  })

  it('posts through a webhook without a saved bot credential', () => {
    const message = missingRequiredFields(
      buildBlock(DiscordV2Block, { operation: 'discord_execute_webhook' })
    )

    expect(message).not.toContain(fieldTitles(DiscordV2Block, ['credential'])[0])
  })
})
