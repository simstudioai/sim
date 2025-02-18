// Import blocks
import { AgentBlock } from './blocks/agent'
import { ApiBlock } from './blocks/api'
import { ConditionBlock } from './blocks/condition'
import { CrewAIVisionBlock } from './blocks/crewai'
import { EvaluatorBlock } from './blocks/evaluator'
import { FirecrawlBlock } from './blocks/firecrawl'
import { FunctionBlock } from './blocks/function'
import { GitHubBlock } from './blocks/github'
import { GmailBlock } from './blocks/gmail'
import { JinaBlock } from './blocks/jina'
import { NotionBlock } from './blocks/notion'
import { OpenAIBlock } from './blocks/openai'
import { PineconeBlock } from './blocks/pinecone'
import { RouterBlock } from './blocks/router'
import { SerperBlock } from './blocks/serper'
import { SlackBlock } from './blocks/slack'
import { StarterBlock } from './blocks/starter'
import { TavilyBlock } from './blocks/tavily'
import { TranslateBlock } from './blocks/translate'
import { XBlock } from './blocks/x'
import { YouTubeBlock } from './blocks/youtube'
import { BlockConfig } from './types'

// Export blocks for ease of use
export {
  AgentBlock,
  ApiBlock,
  FunctionBlock,
  CrewAIVisionBlock,
  FirecrawlBlock,
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
  XBlock,
  StarterBlock,
  PineconeBlock,
  OpenAIBlock,
}

// Registry of all block configurations
const blocks: Record<string, BlockConfig> = {
  agent: AgentBlock,
  api: ApiBlock,
  starter: StarterBlock,
  condition: ConditionBlock,
  function: FunctionBlock,
  router: RouterBlock,
  evaluator: EvaluatorBlock,
  crewai_vision: CrewAIVisionBlock,
  firecrawl: FirecrawlBlock,
  jina: JinaBlock,
  translate: TranslateBlock,
  slack: SlackBlock,
  github: GitHubBlock,
  serper: SerperBlock,
  tavily: TavilyBlock,
  youtube: YouTubeBlock,
  notion: NotionBlock,
  gmail: GmailBlock,
  x: XBlock,
  pinecone: PineconeBlock,
  openai: OpenAIBlock,
}

// Helper functions
export const getBlock = (type: string): BlockConfig | undefined => blocks[type]

export const getBlocksByCategory = (category: 'blocks' | 'tools'): BlockConfig[] =>
  Object.values(blocks).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(blocks)

export const isValidBlockType = (type: string): type is string => type in blocks

export const getAllBlocks = (): BlockConfig[] => Object.values(blocks)
