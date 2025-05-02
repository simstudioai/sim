// Import blocks
import { AgentBlock } from './blocks/agent'
import { AirtableBlock } from './blocks/airtable'
import { ApiBlock } from './blocks/api'
import { BrowserUseBlock } from './blocks/browser_use'
// import { AutoblocksBlock } from './blocks/autoblocks'
import { ConditionBlock } from './blocks/condition'
import { ConfluenceBlock } from './blocks/confluence'
import { GoogleDocsBlock } from './blocks/google_docs'
import { GoogleDriveBlock } from './blocks/drive'
import { ElevenLabsBlock } from './blocks/elevenlabs'
import { EvaluatorBlock } from './blocks/evaluator'
import { ExaBlock } from './blocks/exa'
import { FileBlock } from './blocks/file'
import { FirecrawlBlock } from './blocks/firecrawl'
import { FunctionBlock } from './blocks/function'
import { GitHubBlock } from './blocks/github'
import { GmailBlock } from './blocks/gmail'
import { GoogleSearchBlock } from './blocks/google'
// import { GuestyBlock } from './blocks/guesty'
import { ImageGeneratorBlock } from './blocks/image_generator'
import { JinaBlock } from './blocks/jina'
import { LinkupBlock } from './blocks/linkup'
import { MistralParseBlock } from './blocks/mistral_parse'
import { JiraBlock } from './blocks/jira'
import { NotionBlock } from './blocks/notion'
import { OpenAIBlock } from './blocks/openai'
import { PerplexityBlock } from './blocks/perplexity'
import { PineconeBlock } from './blocks/pinecone'
import { RedditBlock } from './blocks/reddit'
import { RouterBlock } from './blocks/router'
import { SerperBlock } from './blocks/serper'
import { GoogleSheetsBlock } from './blocks/google_sheets'
import { SlackBlock } from './blocks/slack'
import { StagehandBlock } from './blocks/stagehand'
import { StagehandAgentBlock } from './blocks/stagehand_agent'
import { StarterBlock } from './blocks/starter'
import { SupabaseBlock } from './blocks/supabase'
import { TavilyBlock } from './blocks/tavily'
import { ThinkingBlock } from './blocks/thinking'
import { TranslateBlock } from './blocks/translate'
import { TwilioSMSBlock } from './blocks/twilio'
import { TypeformBlock } from './blocks/typeform'
import { VisionBlock } from './blocks/vision'
import { WhatsAppBlock } from './blocks/whatsapp'
import { XBlock } from './blocks/x'
import { YouTubeBlock } from './blocks/youtube'
import { BlockConfig } from './types'
import { Mem0Block } from './blocks/mem0'
import { S3Block } from './blocks/s3'
import { TelegramBlock } from './blocks/telegram'
import { ClayBlock } from './blocks/clay'

// Export blocks for ease of use
export {
  AgentBlock,
  AirtableBlock,
  ApiBlock,
  BrowserUseBlock,
  // AutoblocksBlock,
  ElevenLabsBlock,
  Mem0Block,
  MistralParseBlock,
  FunctionBlock,
  VisionBlock,
  FirecrawlBlock,
  // GuestyBlock,
  FileBlock,
  GoogleSearchBlock,
  JinaBlock,
  LinkupBlock,
  JiraBlock,
  TranslateBlock,
  SlackBlock,
  GitHubBlock,
  ConditionBlock,
  SerperBlock,
  TavilyBlock,
  RouterBlock,
  EvaluatorBlock,
  YouTubeBlock,
  NotionBlock,
  GmailBlock,
  SupabaseBlock,
  XBlock,
  StarterBlock,
  PineconeBlock,
  OpenAIBlock,
  ExaBlock,
  RedditBlock,
  GoogleDriveBlock,
  GoogleDocsBlock,
  WhatsAppBlock,
  GoogleSheetsBlock,
  PerplexityBlock,
  ConfluenceBlock,
  TwilioSMSBlock,
  ImageGeneratorBlock,
  TypeformBlock,
  ThinkingBlock,
  StagehandBlock,
  StagehandAgentBlock,
  S3Block,
  TelegramBlock,
  ClayBlock,
}

// Registry of all block configurations, alphabetically sorted
const blocks: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  browser_use: BrowserUseBlock,
  // autoblocks: AutoblocksBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
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
  // guesty: GuestyBlock,
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  linkup: LinkupBlock,
  jira: JiraBlock,
  mem0: Mem0Block,
  mistral_parse: MistralParseBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  reddit: RedditBlock,
  router: RouterBlock,
  s3: S3Block,
  serper: SerperBlock,
  stagehand: StagehandBlock,
  stagehand_agent: StagehandAgentBlock,
  slack: SlackBlock,
  starter: StarterBlock,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  thinking: ThinkingBlock,
  translate: TranslateBlock,
  twilio_sms: TwilioSMSBlock,
  typeform: TypeformBlock,
  vision: VisionBlock,
  whatsapp: WhatsAppBlock,
  x: XBlock,
  youtube: YouTubeBlock,
  telegram: TelegramBlock,
  clay: ClayBlock,
}

// Helper functions
export const getBlock = (type: string): BlockConfig | undefined => blocks[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools'): BlockConfig[] =>
  Object.values(blocks).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(blocks)

export const isValidBlockType = (type: string): type is string => type in blocks

export const getAllBlocks = (): BlockConfig[] => Object.values(blocks)
