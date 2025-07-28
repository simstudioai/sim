import {
  airtableCreateRecordsTool,
  airtableGetRecordTool,
  airtableListRecordsTool,
  airtableUpdateRecordTool,
} from '@/tools/airtable'
import { browserUseRunTaskTool } from '@/tools/browser_use'
import { clayPopulateTool } from '@/tools/clay'
import { confluenceRetrieveTool, confluenceUpdateTool } from '@/tools/confluence'
import {
  discordGetMessagesTool,
  discordGetServerTool,
  discordGetUserTool,
  discordSendMessageTool,
} from '@/tools/discord'
import { elevenLabsTtsTool } from '@/tools/elevenlabs'
import {
  exaAnswerTool,
  exaFindSimilarLinksTool,
  exaGetContentsTool,
  exaResearchTool,
  exaSearchTool,
} from '@/tools/exa'
import { fileParseTool } from '@/tools/file'
import { crawlTool, scrapeTool, searchTool } from '@/tools/firecrawl'
import { functionExecuteTool } from '@/tools/function'
import {
  githubCommentTool,
  githubLatestCommitTool,
  githubPrTool,
  githubRepoInfoTool,
} from '@/tools/github'
import { gmailDraftTool, gmailReadTool, gmailSearchTool, gmailSendTool } from '@/tools/gmail'
import { searchTool as googleSearchTool } from '@/tools/google'
import {
  googleCalendarCreateTool,
  googleCalendarGetTool,
  googleCalendarInviteTool,
  googleCalendarListTool,
  googleCalendarQuickAddTool,
} from '@/tools/google_calendar'
import { googleDocsCreateTool, googleDocsReadTool, googleDocsWriteTool } from '@/tools/google_docs'
import {
  googleDriveCreateFolderTool,
  googleDriveGetContentTool,
  googleDriveListTool,
  googleDriveUploadTool,
} from '@/tools/google_drive'
import {
  googleSheetsAppendTool,
  googleSheetsReadTool,
  googleSheetsUpdateTool,
  googleSheetsWriteTool,
} from '@/tools/google_sheets'
import { requestTool as httpRequest } from '@/tools/http'
import { huggingfaceChatTool } from '@/tools/huggingface'
import { readUrlTool } from '@/tools/jina'
import { jiraBulkRetrieveTool, jiraRetrieveTool, jiraUpdateTool, jiraWriteTool } from '@/tools/jira'
import {
  knowledgeCreateDocumentTool,
  knowledgeSearchTool,
  knowledgeUploadChunkTool,
} from '@/tools/knowledge'
import { linearCreateIssueTool, linearReadIssuesTool } from '@/tools/linear'
import { linkupSearchTool } from '@/tools/linkup'
import { mem0AddMemoriesTool, mem0GetMemoriesTool, mem0SearchMemoriesTool } from '@/tools/mem0'
import { memoryAddTool, memoryDeleteTool, memoryGetAllTool, memoryGetTool } from '@/tools/memory'
import {
  microsoftExcelReadTool,
  microsoftExcelTableAddTool,
  microsoftExcelWriteTool,
} from '@/tools/microsoft_excel'
import {
  microsoftTeamsReadChannelTool,
  microsoftTeamsReadChatTool,
  microsoftTeamsWriteChannelTool,
  microsoftTeamsWriteChatTool,
} from '@/tools/microsoft_teams'
import { mistralParserTool } from '@/tools/mistral'
import {
  notionCreateDatabaseTool,
  notionCreatePageTool,
  notionQueryDatabaseTool,
  notionReadDatabaseTool,
  notionReadTool,
  notionSearchTool,
  notionWriteTool,
} from '@/tools/notion'
import { imageTool, embeddingsTool as openAIEmbeddings } from '@/tools/openai'
import { outlookDraftTool, outlookReadTool, outlookSendTool } from '@/tools/outlook'
import { perplexityChatTool } from '@/tools/perplexity'
import {
  pineconeFetchTool,
  pineconeGenerateEmbeddingsTool,
  pineconeSearchTextTool,
  pineconeSearchVectorTool,
  pineconeUpsertTextTool,
} from '@/tools/pinecone'
import { qdrantFetchTool, qdrantSearchTool, qdrantUpsertTool } from '@/tools/qdrant'
import { redditGetCommentsTool, redditGetPostsTool, redditHotPostsTool } from '@/tools/reddit'
import { s3GetObjectTool } from '@/tools/s3'
import { searchTool as serperSearch } from '@/tools/serper'
import { slackCanvasTool, slackMessageReaderTool, slackMessageTool } from '@/tools/slack'
import { stagehandAgentTool, stagehandExtractTool } from '@/tools/stagehand'
import {
  supabaseDeleteTool,
  supabaseGetRowTool,
  supabaseInsertTool,
  supabaseQueryTool,
  supabaseUpdateTool,
} from '@/tools/supabase'
import { tavilyExtractTool, tavilySearchTool } from '@/tools/tavily'
import { telegramMessageTool } from '@/tools/telegram'
import { thinkingTool } from '@/tools/thinking'
import { sendSMSTool } from '@/tools/twilio'
import { typeformFilesTool, typeformInsightsTool, typeformResponsesTool } from '@/tools/typeform'
import type { ToolConfig } from '@/tools/types'
import { visionTool } from '@/tools/vision'
import {
  wealthboxReadContactTool,
  wealthboxReadNoteTool,
  wealthboxReadTaskTool,
  wealthboxWriteContactTool,
  wealthboxWriteNoteTool,
  wealthboxWriteTaskTool,
} from '@/tools/wealthbox'
import { whatsappSendMessageTool } from '@/tools/whatsapp'
import { workflowExecutorTool } from '@/tools/workflow'
import { xReadTool, xSearchTool, xUserTool, xWriteTool } from '@/tools/x'
import { youtubeSearchTool } from '@/tools/youtube'

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  browser_use_run_task: browserUseRunTaskTool,
  openai_embeddings: openAIEmbeddings,
  http_request: httpRequest,
  huggingface_chat: huggingfaceChatTool,
  function_execute: functionExecuteTool,
  vision_tool: visionTool,
  file_parser: fileParseTool,
  firecrawl_scrape: scrapeTool,
  firecrawl_search: searchTool,
  firecrawl_crawl: crawlTool,
  google_search: googleSearchTool,
  jina_read_url: readUrlTool,
  linkup_search: linkupSearchTool,
  jira_retrieve: jiraRetrieveTool,
  jira_update: jiraUpdateTool,
  jira_write: jiraWriteTool,
  jira_bulk_read: jiraBulkRetrieveTool,
  slack_message: slackMessageTool,
  slack_message_reader: slackMessageReaderTool,
  slack_canvas: slackCanvasTool,
  github_repo_info: githubRepoInfoTool,
  github_latest_commit: githubLatestCommitTool,
  serper_search: serperSearch,
  tavily_search: tavilySearchTool,
  tavily_extract: tavilyExtractTool,
  supabase_query: supabaseQueryTool,
  supabase_insert: supabaseInsertTool,
  supabase_get_row: supabaseGetRowTool,
  supabase_update: supabaseUpdateTool,
  supabase_delete: supabaseDeleteTool,
  typeform_responses: typeformResponsesTool,
  typeform_files: typeformFilesTool,
  typeform_insights: typeformInsightsTool,
  youtube_search: youtubeSearchTool,
  notion_read: notionReadTool,
  notion_read_database: notionReadDatabaseTool,
  notion_write: notionWriteTool,
  notion_create_page: notionCreatePageTool,
  notion_query_database: notionQueryDatabaseTool,
  notion_search: notionSearchTool,
  notion_create_database: notionCreateDatabaseTool,
  gmail_send: gmailSendTool,
  gmail_read: gmailReadTool,
  gmail_search: gmailSearchTool,
  gmail_draft: gmailDraftTool,
  whatsapp_send_message: whatsappSendMessageTool,
  x_write: xWriteTool,
  x_read: xReadTool,
  x_search: xSearchTool,
  x_user: xUserTool,
  pinecone_fetch: pineconeFetchTool,
  pinecone_generate_embeddings: pineconeGenerateEmbeddingsTool,
  pinecone_search_text: pineconeSearchTextTool,
  pinecone_search_vector: pineconeSearchVectorTool,
  pinecone_upsert_text: pineconeUpsertTextTool,
  github_pr: githubPrTool,
  github_comment: githubCommentTool,
  exa_search: exaSearchTool,
  exa_get_contents: exaGetContentsTool,
  exa_find_similar_links: exaFindSimilarLinksTool,
  exa_answer: exaAnswerTool,
  exa_research: exaResearchTool,
  reddit_hot_posts: redditHotPostsTool,
  reddit_get_posts: redditGetPostsTool,
  reddit_get_comments: redditGetCommentsTool,
  google_drive_get_content: googleDriveGetContentTool,
  google_drive_list: googleDriveListTool,
  google_drive_upload: googleDriveUploadTool,
  google_drive_create_folder: googleDriveCreateFolderTool,
  google_docs_read: googleDocsReadTool,
  google_docs_write: googleDocsWriteTool,
  google_docs_create: googleDocsCreateTool,
  google_sheets_read: googleSheetsReadTool,
  google_sheets_write: googleSheetsWriteTool,
  google_sheets_update: googleSheetsUpdateTool,
  google_sheets_append: googleSheetsAppendTool,
  perplexity_chat: perplexityChatTool,
  confluence_retrieve: confluenceRetrieveTool,
  confluence_update: confluenceUpdateTool,
  twilio_send_sms: sendSMSTool,
  airtable_create_records: airtableCreateRecordsTool,
  airtable_get_record: airtableGetRecordTool,
  airtable_list_records: airtableListRecordsTool,
  airtable_update_record: airtableUpdateRecordTool,
  mistral_parser: mistralParserTool,
  thinking_tool: thinkingTool,
  stagehand_extract: stagehandExtractTool,
  stagehand_agent: stagehandAgentTool,
  mem0_add_memories: mem0AddMemoriesTool,
  mem0_search_memories: mem0SearchMemoriesTool,
  mem0_get_memories: mem0GetMemoriesTool,
  memory_add: memoryAddTool,
  memory_get: memoryGetTool,
  memory_get_all: memoryGetAllTool,
  memory_delete: memoryDeleteTool,
  knowledge_search: knowledgeSearchTool,
  knowledge_upload_chunk: knowledgeUploadChunkTool,
  knowledge_create_document: knowledgeCreateDocumentTool,
  elevenlabs_tts: elevenLabsTtsTool,
  s3_get_object: s3GetObjectTool,
  telegram_message: telegramMessageTool,
  clay_populate: clayPopulateTool,
  discord_send_message: discordSendMessageTool,
  discord_get_messages: discordGetMessagesTool,
  discord_get_server: discordGetServerTool,
  discord_get_user: discordGetUserTool,
  openai_image: imageTool,
  microsoft_teams_read_chat: microsoftTeamsReadChatTool,
  microsoft_teams_write_chat: microsoftTeamsWriteChatTool,
  microsoft_teams_read_channel: microsoftTeamsReadChannelTool,
  microsoft_teams_write_channel: microsoftTeamsWriteChannelTool,
  outlook_read: outlookReadTool,
  outlook_send: outlookSendTool,
  outlook_draft: outlookDraftTool,
  linear_read_issues: linearReadIssuesTool,
  linear_create_issue: linearCreateIssueTool,
  microsoft_excel_read: microsoftExcelReadTool,
  microsoft_excel_write: microsoftExcelWriteTool,
  microsoft_excel_table_add: microsoftExcelTableAddTool,
  google_calendar_create: googleCalendarCreateTool,
  google_calendar_get: googleCalendarGetTool,
  google_calendar_list: googleCalendarListTool,
  google_calendar_quick_add: googleCalendarQuickAddTool,
  google_calendar_invite: googleCalendarInviteTool,
  workflow_executor: workflowExecutorTool,
  wealthbox_read_contact: wealthboxReadContactTool,
  wealthbox_write_contact: wealthboxWriteContactTool,
  wealthbox_read_task: wealthboxReadTaskTool,
  wealthbox_write_task: wealthboxWriteTaskTool,
  wealthbox_read_note: wealthboxReadNoteTool,
  wealthbox_write_note: wealthboxWriteNoteTool,
  qdrant_fetch_points: qdrantFetchTool,
  qdrant_search_vector: qdrantSearchTool,
  qdrant_upsert_points: qdrantUpsertTool,
}
