/**
 * Blocks Registry
 *
 */
// Import all blocks directly here
import { AgentBlock } from './blocks/agent'
import { AirtableBlock } from './blocks/airtable'
import { ApiBlock } from './blocks/api'
import { BrowserUseBlock } from './blocks/browser_use'
import { ClayBlock } from './blocks/clay'
import { ConditionBlock } from './blocks/condition'
import { ConfluenceBlock } from './blocks/confluence'
import { DiscordBlock } from './blocks/discord'
import { ElevenLabsBlock } from './blocks/elevenlabs'
import { EvaluatorBlock } from './blocks/evaluator'
import { ExaBlock } from './blocks/exa'
import { FileBlock } from './blocks/file'
import { FirecrawlBlock } from './blocks/firecrawl'
import { FunctionBlock } from './blocks/function'
import { GitHubBlock } from './blocks/github'
import { GmailBlock } from './blocks/gmail'
import { GoogleSearchBlock } from './blocks/google'
import { GoogleCalendarBlock } from './blocks/google_calendar'
import { GoogleDocsBlock } from './blocks/google_docs'
import { GoogleDriveBlock } from './blocks/google_drive'
import { GoogleSheetsBlock } from './blocks/google_sheets'
import { HuggingFaceBlock } from './blocks/huggingface'
import { ImageGeneratorBlock } from './blocks/image_generator'
import { JinaBlock } from './blocks/jina'
import { JiraBlock } from './blocks/jira'
import { KnowledgeBlock } from './blocks/knowledge'
import { LinearBlock } from './blocks/linear'
import { LinkupBlock } from './blocks/linkup'
import { Mem0Block } from './blocks/mem0'
import { MemoryBlock } from './blocks/memory'
import { MicrosoftExcelBlock } from './blocks/microsoft_excel'
import { MicrosoftTeamsBlock } from './blocks/microsoft_teams'
import { MistralParseBlock } from './blocks/mistral_parse'
import { NotionBlock } from './blocks/notion'
import { OpenAIBlock } from './blocks/openai'
import { OutlookBlock } from './blocks/outlook'
import { PerplexityBlock } from './blocks/perplexity'
import { PineconeBlock } from './blocks/pinecone'
import { RedditBlock } from './blocks/reddit'
import { ResponseBlock } from './blocks/response'
import { RouterBlock } from './blocks/router'
import { S3Block } from './blocks/s3'
import { SerperBlock } from './blocks/serper'
import { SlackBlock } from './blocks/slack'
import { StagehandBlock } from './blocks/stagehand'
import { StagehandAgentBlock } from './blocks/stagehand_agent'
import { StarterBlock } from './blocks/starter'
import { SupabaseBlock } from './blocks/supabase'
import { TavilyBlock } from './blocks/tavily'
import { TelegramBlock } from './blocks/telegram'
import { ThinkingBlock } from './blocks/thinking'
import { TranslateBlock } from './blocks/translate'
import { TwilioSMSBlock } from './blocks/twilio'
import { TypeformBlock } from './blocks/typeform'
import { VisionBlock } from './blocks/vision'
import { WealthboxBlock } from './blocks/wealthbox'
import { WhatsAppBlock } from './blocks/whatsapp'
import { WorkflowBlock } from './blocks/workflow'
import { XBlock } from './blocks/x'
import { YouTubeBlock } from './blocks/youtube'
import type { BlockConfig } from './types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
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
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  jira: JiraBlock,
  knowledge: KnowledgeBlock,
  linear: LinearBlock,
  linkup: LinkupBlock,
  mem0: Mem0Block,
  memory: MemoryBlock,
  microsoft_excel: MicrosoftExcelBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  mistral_parse: MistralParseBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  reddit: RedditBlock,
  response: ResponseBlock,
  router: RouterBlock,
  s3: S3Block,
  serper: SerperBlock,
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
  whatsapp: WhatsAppBlock,
  workflow: WorkflowBlock,
  x: XBlock,
  youtube: YouTubeBlock,
}

// Helper functions to access the registry
export const getBlock = (type: string): BlockConfig | undefined => registry[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string => type in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
