import {
  airtableCreateRecordsTool,
  airtableGetRecordTool,
  airtableListRecordsTool,
  airtableUpdateRecordTool,
} from './airtable'
import { autoblocksPromptManagerTool } from './autoblocks'
import { browserUseRunTaskTool } from './browser_use'
import { clayPopulateTool } from './clay'
import { confluenceRetrieveTool, confluenceUpdateTool } from './confluence'
import {
  discordGetMessagesTool,
  discordGetServerTool,
  discordGetUserTool,
  discordSendMessageTool,
} from './discord'
import { elevenLabsTtsTool } from './elevenlabs'
import { exaAnswerTool, exaFindSimilarLinksTool, exaGetContentsTool, exaSearchTool } from './exa'
import { fileParseTool } from './file'
import { scrapeTool, searchTool } from './firecrawl'
import { functionExecuteTool } from './function'
import {
  githubCommentTool,
  githubLatestCommitTool,
  githubPrTool,
  githubRepoInfoTool,
} from './github'
import { gmailReadTool, gmailSearchTool, gmailSendTool } from './gmail'
import { searchTool as googleSearchTool } from './google'
import {
  googleCalendarCreateTool,
  googleCalendarGetTool,
  googleCalendarInviteTool,
  googleCalendarListTool,
  googleCalendarQuickAddTool,
} from './google_calendar'
import { googleDocsCreateTool, googleDocsReadTool, googleDocsWriteTool } from './google_docs'
import {
  googleDriveCreateFolderTool,
  googleDriveGetContentTool,
  googleDriveListTool,
  googleDriveUploadTool,
} from './google_drive'
import {
  googleSheetsAppendTool,
  googleSheetsReadTool,
  googleSheetsUpdateTool,
  googleSheetsWriteTool,
} from './google_sheets'
import { guestyGuestTool, guestyReservationTool } from './guesty'
import { requestTool as httpRequest } from './http'
import { contactsTool as hubspotContacts } from './hubspot/contacts'
import { huggingfaceChatTool } from './huggingface'
import { readUrlTool } from './jina'
import { jiraBulkRetrieveTool, jiraRetrieveTool, jiraUpdateTool, jiraWriteTool } from './jira'
import { knowledgeSearchTool, knowledgeUploadChunkTool } from './knowledge'
import { linearCreateIssueTool, linearReadIssuesTool } from './linear'
import { linkupSearchTool } from './linkup'
import { mem0AddMemoriesTool, mem0GetMemoriesTool, mem0SearchMemoriesTool } from './mem0'
import { memoryAddTool, memoryDeleteTool, memoryGetAllTool, memoryGetTool } from './memory'
import {
  microsoftExcelReadTool,
  microsoftExcelTableAddTool,
  microsoftExcelWriteTool,
} from './microsoft_excel'
import {
  microsoftTeamsReadChannelTool,
  microsoftTeamsReadChatTool,
  microsoftTeamsWriteChannelTool,
  microsoftTeamsWriteChatTool,
} from './microsoft_teams'
import { mistralParserTool } from './mistral'
import { notionReadTool, notionWriteTool } from './notion'
import { imageTool, embeddingsTool as openAIEmbeddings } from './openai'
import { outlookDraftTool, outlookReadTool, outlookSendTool } from './outlook'
import { perplexityChatTool } from './perplexity'
import {
  pineconeFetchTool,
  pineconeGenerateEmbeddingsTool,
  pineconeSearchTextTool,
  pineconeSearchVectorTool,
  pineconeUpsertTextTool,
} from './pinecone'
import { redditGetCommentsTool, redditGetPostsTool, redditHotPostsTool } from './reddit'
import { s3GetObjectTool } from './s3'
import { opportunitiesTool as salesforceOpportunities } from './salesforce/opportunities'
import { searchTool as serperSearch } from './serper'
import { slackMessageTool } from './slack'
import { stagehandAgentTool, stagehandExtractTool } from './stagehand'
import { supabaseInsertTool, supabaseQueryTool } from './supabase'
import { tavilyExtractTool, tavilySearchTool } from './tavily'
import { telegramMessageTool } from './telegram'
import { thinkingTool } from './thinking'
import { sendSMSTool } from './twilio'
import { typeformFilesTool, typeformInsightsTool, typeformResponsesTool } from './typeform'
import type { ToolConfig } from './types'
import { visionTool } from './vision'
import { whatsappSendMessageTool } from './whatsapp'
import { workflowExecutorTool } from './workflow'
import { xReadTool, xSearchTool, xUserTool, xWriteTool } from './x'
import { youtubeSearchTool } from './youtube'

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  browser_use_run_task: browserUseRunTaskTool,
  autoblocks_prompt_manager: autoblocksPromptManagerTool,
  openai_embeddings: openAIEmbeddings,
  http_request: httpRequest,
  huggingface_chat: huggingfaceChatTool,
  hubspot_contacts: hubspotContacts,
  salesforce_opportunities: salesforceOpportunities,
  function_execute: functionExecuteTool,
  vision_tool: visionTool,
  file_parser: fileParseTool,
  firecrawl_scrape: scrapeTool,
  firecrawl_search: searchTool,
  google_search: googleSearchTool,
  jina_read_url: readUrlTool,
  linkup_search: linkupSearchTool,
  jira_retrieve: jiraRetrieveTool,
  jira_update: jiraUpdateTool,
  jira_write: jiraWriteTool,
  jira_bulk_read: jiraBulkRetrieveTool,
  slack_message: slackMessageTool,
  github_repo_info: githubRepoInfoTool,
  github_latest_commit: githubLatestCommitTool,
  serper_search: serperSearch,
  tavily_search: tavilySearchTool,
  tavily_extract: tavilyExtractTool,
  supabase_query: supabaseQueryTool,
  supabase_insert: supabaseInsertTool,
  typeform_responses: typeformResponsesTool,
  typeform_files: typeformFilesTool,
  typeform_insights: typeformInsightsTool,
  youtube_search: youtubeSearchTool,
  notion_read: notionReadTool,
  notion_write: notionWriteTool,
  gmail_send: gmailSendTool,
  gmail_read: gmailReadTool,
  gmail_search: gmailSearchTool,
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
  guesty_reservation: guestyReservationTool,
  guesty_guest: guestyGuestTool,
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
}
