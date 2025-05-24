/**
 * Blocks Registry
 *
 */
// Import all blocks directly here
import { AgentBlock } from './blocks/agent'
import { AirtableBlock } from './blocks/airtable'
import { ApiBlock } from './blocks/api'
// import { AutoblocksBlock } from './blocks/autoblocks'
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
import { GoogleDocsBlock } from './blocks/google_docs'
import { GoogleDriveBlock } from './blocks/google_drive'
import { GoogleSheetsBlock } from './blocks/google_sheets'
// import { GuestyBlock } from './blocks/guesty'
import { ImageGeneratorBlock } from './blocks/image_generator'
import { JinaBlock } from './blocks/jina'
import { JiraBlock } from './blocks/jira'
import { LinkupBlock } from './blocks/linkup'
import { Mem0Block } from './blocks/mem0'
// import { GuestyBlock } from './blocks/guesty'
import { MemoryBlock } from './blocks/memory'
import { MicrosoftTeamsBlock } from './blocks/microsoft_teams'
import { MistralParseBlock } from './blocks/mistral_parse'
import { NotionBlock } from './blocks/notion'
import { OpenAIBlock } from './blocks/openai'
import { OutlookBlock } from './blocks/outlook'
import { PerplexityBlock } from './blocks/perplexity'
import { PineconeBlock } from './blocks/pinecone'
import { RedditBlock } from './blocks/reddit'
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
import { WhatsAppBlock } from './blocks/whatsapp'
import { XBlock } from './blocks/x'
import { YouTubeBlock } from './blocks/youtube'
import type { BlockConfig } from './types'

// Registry of all available blocks, alphabetically sorted
export const registry: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  // autoblocks: AutoblocksBlock,
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
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_search: GoogleSearchBlock,
  google_sheets: GoogleSheetsBlock,
  microsoft_teams: MicrosoftTeamsBlock,
  // guesty: GuestyBlock,
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  jira: JiraBlock,
  linkup: LinkupBlock,
  mem0: Mem0Block,
  mistral_parse: MistralParseBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  outlook: OutlookBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  reddit: RedditBlock,
  router: RouterBlock,
  memory: MemoryBlock,
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
  whatsapp: WhatsAppBlock,
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
