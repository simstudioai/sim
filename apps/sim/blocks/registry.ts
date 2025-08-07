/**
 * Blocks Registry
 *
 */

import { AgentBlock } from '@/blocks/blocks/agent'
import { AirtableBlock } from '@/blocks/blocks/airtable'
import { ApiBlock } from '@/blocks/blocks/api'
import { ArxivBlock } from '@/blocks/blocks/arxiv'
import { BrowserUseBlock } from '@/blocks/blocks/browser_use'
import { ClayBlock } from '@/blocks/blocks/clay'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ConfluenceBlock } from '@/blocks/blocks/confluence'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock } from '@/blocks/blocks/exa'
import { FileBlock } from '@/blocks/blocks/file'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GitHubBlock } from '@/blocks/blocks/github'
import { GmailBlock } from '@/blocks/blocks/gmail'
import { GoogleSearchBlock } from '@/blocks/blocks/google'
import { GoogleCalendarBlock } from '@/blocks/blocks/google_calendar'
import { GoogleDocsBlock } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock } from '@/blocks/blocks/google_drive'
import { GoogleSheetsBlock } from '@/blocks/blocks/google_sheets'
import { HuggingFaceBlock } from '@/blocks/blocks/huggingface'
import { HunterBlock } from '@/blocks/blocks/hunter'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { JinaBlock } from '@/blocks/blocks/jina'
import { JiraBlock } from '@/blocks/blocks/jira'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LinearBlock } from '@/blocks/blocks/linear'
import { LinkupBlock } from '@/blocks/blocks/linkup'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MicrosoftExcelBlock } from '@/blocks/blocks/microsoft_excel'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import { MicrosoftTeamsBlock } from '@/blocks/blocks/microsoft_teams'
import { MistralParseBlock } from '@/blocks/blocks/mistral_parse'
import { NotionBlock } from '@/blocks/blocks/notion'
import { OneDriveBlock } from '@/blocks/blocks/onedrive'
import { OpenAIBlock } from '@/blocks/blocks/openai'
import { OutlookBlock } from '@/blocks/blocks/outlook'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import { PineconeBlock } from '@/blocks/blocks/pinecone'
import { QdrantBlock } from '@/blocks/blocks/qdrant'
import { RedditBlock } from '@/blocks/blocks/reddit'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock } from '@/blocks/blocks/router'
import { S3Block } from '@/blocks/blocks/s3'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SerperBlock } from '@/blocks/blocks/serper'
import { SharepointBlock } from '@/blocks/blocks/sharepoint'
import { SlackBlock } from '@/blocks/blocks/slack'
import { StagehandBlock } from '@/blocks/blocks/stagehand'
import { StagehandAgentBlock } from '@/blocks/blocks/stagehand_agent'
import { StarterBlock } from '@/blocks/blocks/starter'
import { SupabaseBlock } from '@/blocks/blocks/supabase'
import { TavilyBlock } from '@/blocks/blocks/tavily'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TwilioSMSBlock } from '@/blocks/blocks/twilio'
import { TypeformBlock } from '@/blocks/blocks/typeform'
import { VisionBlock } from '@/blocks/blocks/vision'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { WebhookBlock } from '@/blocks/blocks/webhook'
import { WhatsAppBlock } from '@/blocks/blocks/whatsapp'
import { WikipediaBlock } from '@/blocks/blocks/wikipedia'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { XBlock } from '@/blocks/blocks/x'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import type { BlockConfig } from '@/blocks/types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  arxiv: ArxivBlock,
  browser_use: BrowserUseBlock,
  clay: ClayBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  discord: DiscordBlock,
  elevenlabs: ElevenLabsBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  firecrawl: FirecrawlBlock,
  file: FileBlock,
  function: FunctionBlock,
  github: GitHubBlock,
  gmail: GmailBlock,
  google_calendar: GoogleCalendarBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  huggingface: HuggingFaceBlock,
  hunter: HunterBlock,
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  jira: JiraBlock,
  knowledge: KnowledgeBlock,
  linear: LinearBlock,
  linkup: LinkupBlock,
  mem0: Mem0Block,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_planner: MicrosoftPlannerBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  onedrive: OneDriveBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  qdrant: QdrantBlock,
  memory: MemoryBlock,
  reddit: RedditBlock,
  response: ResponseBlock,
  router: RouterBlock,
  schedule: ScheduleBlock,
  s3: S3Block,
  serper: SerperBlock,
  sharepoint: SharepointBlock,
  stagehand: StagehandBlock,
  stagehand_agent: StagehandAgentBlock,
  slack: SlackBlock,
  starter: StarterBlock,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  telegram: TelegramBlock,
  thinking: ThinkingBlock,
  translate: TranslateBlock,
  twilio_sms: TwilioSMSBlock,
  typeform: TypeformBlock,
  vision: VisionBlock,
  wealthbox: WealthboxBlock,
  webhook: WebhookBlock,
  whatsapp: WhatsAppBlock,
  wikipedia: WikipediaBlock,
  workflow: WorkflowBlock,
  x: XBlock,
  youtube: YouTubeBlock,
}

export const getBlock = (type: string): BlockConfig | undefined => registry[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string => type in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
