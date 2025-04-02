// Import blocks
import { AgentBlock } from './blocks/agent'
import { AirtableBlock } from './blocks/airtable'
import { ApiBlock } from './blocks/api'
import { ConditionBlock } from './blocks/condition'
import { ConfluenceBlock } from './blocks/confluence'
import { GoogleDocsBlock } from './blocks/docs'
import { GoogleDriveBlock } from './blocks/drive'
import { EvaluatorBlock } from './blocks/evaluator'
import { ExaBlock } from './blocks/exa'
import { FileBlock } from './blocks/file'
import { FirecrawlBlock } from './blocks/firecrawl'
import { FunctionBlock } from './blocks/function'
import { GitHubBlock } from './blocks/github'
import { GmailBlock } from './blocks/gmail'
// import { GuestyBlock } from './blocks/guesty'
import { ImageGeneratorBlock } from './blocks/image-generator'
import { JinaBlock } from './blocks/jina'
import { NotionBlock } from './blocks/notion'
import { OpenAIBlock } from './blocks/openai'
import { PerplexityBlock } from './blocks/perplexity'
import { PineconeBlock } from './blocks/pinecone'
import { RedditBlock } from './blocks/reddit'
import { RouterBlock } from './blocks/router'
import { SerperBlock } from './blocks/serper'
import { GoogleSheetsBlock } from './blocks/sheets'
import { SlackBlock } from './blocks/slack'
import { StarterBlock } from './blocks/starter'
import { SupabaseBlock } from './blocks/supabase'
import { TavilyBlock } from './blocks/tavily'
import { TranslateBlock } from './blocks/translate'
import { TwilioSMSBlock } from './blocks/twilio'
import { TypeformBlock } from './blocks/typeform'
import { VisionBlock } from './blocks/vision'
import { WhatsAppBlock } from './blocks/whatsapp'
import { XBlock } from './blocks/x'
import { YouTubeBlock } from './blocks/youtube'
import { BlockConfig } from './types'

// Export blocks for ease of use
export {
  AgentBlock,
  AirtableBlock,
  ApiBlock,
  FileBlock,
  FunctionBlock,
  VisionBlock,
  FirecrawlBlock,
  // GuestyBlock,
  JinaBlock,
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
}

// Registry of all block configurations, alphabetically sorted
const blocks: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  condition: ConditionBlock,
  confluence: ConfluenceBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  file: FileBlock,
  firecrawl: FirecrawlBlock,
  function: FunctionBlock,
  github: GitHubBlock,
  gmail: GmailBlock,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_sheets: GoogleSheetsBlock,
  // guesty: GuestyBlock,
  image_generator: ImageGeneratorBlock,
  jina: JinaBlock,
  notion: NotionBlock,
  openai: OpenAIBlock,
  perplexity: PerplexityBlock,
  pinecone: PineconeBlock,
  reddit: RedditBlock,
  router: RouterBlock,
  serper: SerperBlock,
  slack: SlackBlock,
  starter: StarterBlock,
  supabase: SupabaseBlock,
  tavily: TavilyBlock,
  translate: TranslateBlock,
  twilio_sms: TwilioSMSBlock,
  typeform: TypeformBlock,
  vision: VisionBlock,
  whatsapp: WhatsAppBlock,
  x: XBlock,
  youtube: YouTubeBlock,
}

// Helper functions
export const getBlock = (type: string): BlockConfig | undefined => blocks[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools'): BlockConfig[] =>
  Object.values(blocks).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(blocks)

export const isValidBlockType = (type: string): type is string => type in blocks

export const getAllBlocks = (): BlockConfig[] => Object.values(blocks)
