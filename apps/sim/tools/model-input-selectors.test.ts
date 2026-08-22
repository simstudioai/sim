/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { a2aSendMessageTool } from '@/tools/a2a/send_message'
import { agentphoneCreateCallTool } from '@/tools/agentphone/create_call'
import { airweaveSearchTool } from '@/tools/airweave/search'
import { brightDataDiscoverTool } from '@/tools/brightdata/discover'
import { contextDevExtractTool } from '@/tools/context_dev/extract'
import { contextDevSearchTool } from '@/tools/context_dev/search'
import { addFollowupTool, addFollowupV2Tool } from '@/tools/cursor/add_followup'
import { launchAgentTool, launchAgentV2Tool } from '@/tools/cursor/launch_agent'
import { devinCreateSessionTool } from '@/tools/devin/create_session'
import { devinSendMessageTool } from '@/tools/devin/send_message'
import { chainOfThoughtTool } from '@/tools/dspy/chain_of_thought'
import { predictTool } from '@/tools/dspy/predict'
import { reactTool } from '@/tools/dspy/react'
import { agentTool as exaAgentTool } from '@/tools/exa/agent'
import { answerTool as exaAnswerTool } from '@/tools/exa/answer'
import { getContentsTool as exaGetContentsTool } from '@/tools/exa/get_contents'
import { searchTool as exaSearchTool } from '@/tools/exa/search'
import { agentTool as firecrawlAgentTool } from '@/tools/firecrawl/agent'
import { batchScrapeTool as firecrawlBatchScrapeTool } from '@/tools/firecrawl/batch-scrape'
import { crawlTool as firecrawlCrawlTool } from '@/tools/firecrawl/crawl'
import { extractTool as firecrawlExtractTool } from '@/tools/firecrawl/extract'
import { parseTool as firecrawlParseTool } from '@/tools/firecrawl/parse'
import { scrapeTool as firecrawlScrapeTool } from '@/tools/firecrawl/scrape'
import { searchTool as firecrawlSearchTool } from '@/tools/firecrawl/search'
import { flintCreateTaskTool } from '@/tools/flint/create_task'
import { flintGeneratePagesTool } from '@/tools/flint/generate_pages'
import { generateTool as gammaGenerateTool } from '@/tools/gamma/generate'
import { generateFromTemplateTool as gammaGenerateFromTemplateTool } from '@/tools/gamma/generate_from_template'
import { askAnythingTool as gongAskAnythingTool } from '@/tools/gong/ask_anything'
import { googleTranslateTool } from '@/tools/google_translate/text'
import { queryTool as greptileQueryTool } from '@/tools/greptile/query'
import { discoverTool as hunterDiscoverTool } from '@/tools/hunter/discover'
import { searchTool as linkupSearchTool } from '@/tools/linkup/search'
import { requestHighlightsTool as logrocketRequestHighlightsTool } from '@/tools/logrocket/request_highlights'
import { mem0SearchMemoriesTool } from '@/tools/mem0/search_memories'
import { deepResearchTool as parallelDeepResearchTool } from '@/tools/parallel/deep_research'
import { searchTextTool as pineconeSearchTextTool } from '@/tools/pinecone/search_text'
import { upsertTextTool as pineconeUpsertTextTool } from '@/tools/pinecone/upsert_text'
import { sixtyfourEnrichCompanyTool } from '@/tools/sixtyfour/enrich_company'
import { sixtyfourEnrichLeadTool } from '@/tools/sixtyfour/enrich_lead'
import { geminiSttTool, geminiSttV2Tool } from '@/tools/stt/gemini'
import { crawlTool as tavilyCrawlTool } from '@/tools/tavily/crawl'
import { mapTool as tavilyMapTool } from '@/tools/tavily/map'
import { searchTool as tavilySearchTool } from '@/tools/tavily/search'
import { textractParserTool } from '@/tools/textract/parser'
import type { ToolConfig } from '@/tools/types'
import { zepAddMessagesTool } from '@/tools/zep/add_messages'

function selectModelInput(
  tool: ToolConfig,
  params: Record<string, unknown>
): Record<string, unknown> {
  const modelInput = tool.request.modelInput
  expect(modelInput?.mode).toBe('project')
  if (modelInput?.mode !== 'project') throw new Error(`Expected ${tool.id} to project model input`)
  const selected = modelInput.select(params)
  expect(Object.keys(selected).every((key) => Object.hasOwn(tool.params, key))).toBe(true)
  return selected
}

describe('model-facing integration selectors', () => {
  it.each([
    [launchAgentTool, { promptText: 'build it' }, { promptText: 'build it' }],
    [launchAgentV2Tool, { promptText: 'build it' }, { promptText: 'build it' }],
    [addFollowupTool, { followupPromptText: 'continue' }, { followupPromptText: 'continue' }],
    [addFollowupV2Tool, { followupPromptText: 'continue' }, { followupPromptText: 'continue' }],
    [devinCreateSessionTool, { prompt: 'fix it' }, { prompt: 'fix it' }],
    [devinSendMessageTool, { message: 'retry' }, { message: 'retry' }],
    [
      a2aSendMessageTool,
      { message: 'hello', data: { request: 'details' } },
      { message: 'hello', data: { request: 'details' } },
    ],
    [
      exaAgentTool,
      { query: 'research', outputSchema: { type: 'object' }, systemPrompt: 'be concise' },
      { query: 'research', outputSchema: { type: 'object' }, systemPrompt: 'be concise' },
    ],
    [
      exaAnswerTool,
      { query: 'answer', outputSchema: { type: 'object' } },
      { query: 'answer', outputSchema: { type: 'object' } },
    ],
    [
      exaSearchTool,
      {
        query: 'search',
        summaryQuery: 'summarize',
        outputSchema: { type: 'object' },
        systemPrompt: 'format this',
      },
      {
        query: 'search',
        summaryQuery: 'summarize',
        outputSchema: { type: 'object' },
        systemPrompt: 'format this',
      },
    ],
    [exaGetContentsTool, { summaryQuery: 'summarize' }, { summaryQuery: 'summarize' }],
    [
      firecrawlAgentTool,
      { prompt: 'extract', schema: { type: 'object' } },
      { prompt: 'extract', schema: { type: 'object' } },
    ],
    [
      firecrawlExtractTool,
      { prompt: 'extract', schema: { type: 'object' } },
      { prompt: 'extract', schema: { type: 'object' }, scrapeOptions: undefined },
    ],
    [
      firecrawlCrawlTool,
      { prompt: 'focus on docs' },
      { prompt: 'focus on docs', formats: undefined },
    ],
    [
      firecrawlScrapeTool,
      {
        formats: [
          'markdown',
          { type: 'json', prompt: 'extract pricing', schema: { type: 'object' } },
        ],
      },
      { formats: [{}, { prompt: 'extract pricing', schema: { type: 'object' } }] },
    ],
    [
      firecrawlBatchScrapeTool,
      { formats: [{ type: 'question', question: 'What changed?' }] },
      { formats: [{ question: 'What changed?' }] },
    ],
    [
      firecrawlSearchTool,
      { scrapeOptions: { formats: [{ type: 'json', prompt: 'extract plans' }] } },
      { scrapeOptions: { formats: [{ prompt: 'extract plans' }] } },
    ],
    [
      firecrawlParseTool,
      { formats: [{ type: 'json', schema: { type: 'object' } }] },
      { formats: [{ schema: { type: 'object' } }] },
    ],
    [greptileQueryTool, { query: 'where is auth?' }, { query: 'where is auth?' }],
    [hunterDiscoverTool, { query: 'developer tools' }, { query: 'developer tools' }],
    [googleTranslateTool, { text: 'hello' }, { text: 'hello' }],
    [
      gongAskAnythingTool,
      { question: 'What objections came up?' },
      { question: 'What objections came up?' },
    ],
    [
      contextDevExtractTool,
      { schema: { type: 'object' }, instructions: 'extract pricing' },
      { schema: { type: 'object' }, instructions: 'extract pricing' },
    ],
    [mem0SearchMemoriesTool, { query: 'favorite food' }, { query: 'favorite food' }],
    [parallelDeepResearchTool, { input: 'research goal' }, { input: 'research goal' }],
    [
      pineconeSearchTextTool,
      { searchQuery: 'semantic query', rerank: { query: { text: 'rerank query' } } },
      { searchQuery: 'semantic query', rerank: { query: { text: 'rerank query' } } },
    ],
    [geminiSttTool, { language: 'English' }, { language: 'English' }],
    [geminiSttV2Tool, { language: 'English' }, { language: 'English' }],
    [
      gammaGenerateTool,
      {
        inputText: 'deck content',
        additionalInstructions: 'short deck',
        textTone: 'professional',
        textAudience: 'executives',
        imageStyle: 'watercolor',
      },
      {
        inputText: 'deck content',
        additionalInstructions: 'short deck',
        textTone: 'professional',
        textAudience: 'executives',
        imageStyle: 'watercolor',
      },
    ],
    [
      gammaGenerateFromTemplateTool,
      { prompt: 'adapt this', imageStyle: 'editorial' },
      { prompt: 'adapt this', imageStyle: 'editorial' },
    ],
    [
      predictTool,
      { input: 'predict', context: 'context' },
      { input: 'predict', context: 'context' },
    ],
    [
      chainOfThoughtTool,
      { question: 'why?', context: 'facts' },
      { question: 'why?', context: 'facts' },
    ],
    [
      reactTool,
      { task: 'investigate', context: 'facts' },
      { task: 'investigate', context: 'facts' },
    ],
    [flintCreateTaskTool, { prompt: 'add an about page' }, { prompt: 'add an about page' }],
    [
      flintGeneratePagesTool,
      { items: [{ targetPageSlug: '/about', context: 'write the page' }] },
      { items: ['write the page'] },
    ],
    [
      agentphoneCreateCallTool,
      { initialGreeting: 'hello', systemPrompt: 'answer questions' },
      { initialGreeting: 'hello', systemPrompt: 'answer questions' },
    ],
    [
      sixtyfourEnrichCompanyTool,
      {
        targetCompany: '{"name":"Acme"}',
        struct: '{"size":"Employee count"}',
        researchPlan: 'use primary sources',
        peopleFocusPrompt: 'find engineering leaders',
        leadStruct: '{"name":"Full name"}',
      },
      {
        targetCompany: '{"name":"Acme"}',
        struct: '{"size":"Employee count"}',
        researchPlan: 'use primary sources',
        peopleFocusPrompt: 'find engineering leaders',
        leadStruct: '{"name":"Full name"}',
      },
    ],
    [
      sixtyfourEnrichLeadTool,
      {
        leadInfo: '{"name":"Ada"}',
        struct: '{"email":"Work email"}',
        researchPlan: 'use primary sources',
      },
      {
        leadInfo: '{"name":"Ada"}',
        struct: '{"email":"Work email"}',
        researchPlan: 'use primary sources',
      },
    ],
    [
      zepAddMessagesTool,
      {
        messages: [{ role: 'user', content: 'hello', metadata: { source: 'ordinary metadata' } }],
      },
      { messages: ['hello'] },
    ],
    [
      pineconeUpsertTextTool,
      { records: [{ _id: 'record-1', chunk_text: 'embed this', category: 'docs' }] },
      { records: ['embed this'] },
    ],
  ])('%s selects only declared model-facing fields', (tool, params, expected) => {
    expect(
      selectModelInput(tool, { ...params, apiKey: 'credential', callbackUrl: 'transport' })
    ).toStrictEqual(expected)
  })

  it('projects Tavily search queries only when model-assisted behavior is enabled', () => {
    expect(selectModelInput(tavilySearchTool, { query: 'plain search' })).toStrictEqual({})
    expect(
      selectModelInput(tavilySearchTool, { query: 'answer this', include_answer: 'advanced' })
    ).toStrictEqual({ query: 'answer this' })
    expect(
      selectModelInput(tavilySearchTool, { query: 'classify intent', auto_parameters: true })
    ).toStrictEqual({ query: 'classify intent' })
    expect(
      selectModelInput(tavilySearchTool, { query: 'plain search', include_answer: 'false' })
    ).toStrictEqual({})
  })

  it('projects Linkup queries only for sourced answers', () => {
    expect(
      selectModelInput(linkupSearchTool, { q: 'raw search', outputType: 'searchResults' })
    ).toStrictEqual({})
    expect(
      selectModelInput(linkupSearchTool, { q: 'answer this', outputType: 'sourcedAnswer' })
    ).toStrictEqual({ q: 'answer this' })
  })

  it('projects Airweave queries only when the effective search path uses a model', () => {
    expect(
      selectModelInput(airweaveSearchTool, {
        query: 'literal keyword',
        retrievalStrategy: 'keyword',
      })
    ).toStrictEqual({})
    expect(
      selectModelInput(airweaveSearchTool, {
        query: 'semantic search',
        retrievalStrategy: 'hybrid',
      })
    ).toStrictEqual({ query: 'semantic search' })
    expect(
      selectModelInput(airweaveSearchTool, {
        query: 'expand this',
        retrievalStrategy: 'keyword',
        expandQuery: true,
      })
    ).toStrictEqual({ query: 'expand this' })
  })

  it('projects only the effective Bright Data AI-ranking input', () => {
    expect(
      selectModelInput(brightDataDiscoverTool, {
        query: 'raw results',
        intent: 'unused intent',
        mode: 'zeroRanking',
      })
    ).toStrictEqual({})
    expect(
      selectModelInput(brightDataDiscoverTool, {
        query: 'search terms',
        intent: 'rank official pricing pages',
      })
    ).toStrictEqual({ intent: 'rank official pricing pages' })
    expect(selectModelInput(brightDataDiscoverTool, { query: 'fallback intent' })).toStrictEqual({
      query: 'fallback intent',
    })
  })

  it('projects only Textract query text when the QUERIES feature is active', () => {
    const modelInput = textractParserTool.request.modelInput
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Textract queries to define a nested projector')
    }

    const queries = [
      { Text: 'invoice total', Alias: 'total', Pages: ['1'] },
      { Text: 'vendor name', Alias: 'vendor' },
    ]
    expect(modelInput.select({ featureTypes: ['TABLES'], queries })).toStrictEqual({})
    expect(modelInput.select({ featureTypes: ['QUERIES'], queries })).toStrictEqual({
      queries: ['invoice total', 'vendor name'],
    })
    expect(
      modelInput.applyProjected({ queries }, { queries: ['{{TOTAL_QUERY}}', '{{VENDOR_QUERY}}'] })
    ).toStrictEqual({
      queries: [
        { Text: '{{TOTAL_QUERY}}', Alias: 'total', Pages: ['1'] },
        { Text: '{{VENDOR_QUERY}}', Alias: 'vendor' },
      ],
    })
  })

  it('projects only the LogRocket Galileo question, never the session lookup or control fields', () => {
    expect(
      selectModelInput(logrocketRequestHighlightsTool, {
        question: 'why did checkout fail',
        userEmail: 'user@example.com',
        userID: 'user-1',
        startMs: '1700000000000',
        endMs: '1700003600000',
        webhookURL: 'https://example.com/hook',
      })
    ).toStrictEqual({ question: 'why did checkout fail' })
    expect(
      selectModelInput(logrocketRequestHighlightsTool, { userEmail: 'user@example.com' })
    ).toStrictEqual({})
  })

  it('projects Tavily and Context.dev natural-language crawl or fanout instructions', () => {
    expect(selectModelInput(tavilyCrawlTool, { instructions: 'find pricing' })).toStrictEqual({
      instructions: 'find pricing',
    })
    expect(selectModelInput(tavilyMapTool, { instructions: 'find docs' })).toStrictEqual({
      instructions: 'find docs',
    })
    expect(selectModelInput(contextDevSearchTool, { query: 'plain search' })).toStrictEqual({})
    expect(
      selectModelInput(contextDevSearchTool, { query: 'expand this', queryFanout: true })
    ).toStrictEqual({ query: 'expand this' })
  })
})
