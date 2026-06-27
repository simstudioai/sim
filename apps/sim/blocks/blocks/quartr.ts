import { QuartrIcon } from '@/components/icons'
import { QuartrBlockDisplay } from '@/blocks/blocks/quartr.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

const ALL_LIST_OPERATIONS = [
  'list_companies',
  'list_events',
  'list_event_types',
  'list_documents',
  'list_document_types',
  'list_reports',
  'list_slide_decks',
  'list_transcripts',
  'list_audio',
  'list_live_events',
]

const COMPANY_SCOPED_LIST_OPERATIONS = [
  'list_companies',
  'list_events',
  'list_documents',
  'list_reports',
  'list_slide_decks',
  'list_transcripts',
  'list_audio',
  'list_live_events',
]

const DOCUMENT_LIST_OPERATIONS = [
  'list_documents',
  'list_reports',
  'list_slide_decks',
  'list_transcripts',
]

const EVENT_SCOPED_LIST_OPERATIONS = [...DOCUMENT_LIST_OPERATIONS, 'list_audio', 'list_live_events']

const DATE_RANGE_LIST_OPERATIONS = [
  'list_events',
  ...DOCUMENT_LIST_OPERATIONS,
  'list_audio',
  'list_live_events',
]

const UPDATED_RANGE_LIST_OPERATIONS = ['list_companies', ...DATE_RANGE_LIST_OPERATIONS]

export const QuartrBlock: BlockConfig<ToolResponse> = {
  ...QuartrBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Companies', id: 'list_companies' },
        { label: 'Get Company', id: 'get_company' },
        { label: 'List Events', id: 'list_events' },
        { label: 'Get Event', id: 'get_event' },
        { label: 'Get Event Summary', id: 'get_event_summary' },
        { label: 'List Event Types', id: 'list_event_types' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'List Document Types', id: 'list_document_types' },
        { label: 'List Reports', id: 'list_reports' },
        { label: 'Get Report', id: 'get_report' },
        { label: 'List Slide Decks', id: 'list_slide_decks' },
        { label: 'Get Slide Deck', id: 'get_slide_deck' },
        { label: 'List Transcripts', id: 'list_transcripts' },
        { label: 'Get Transcript', id: 'get_transcript' },
        { label: 'List Audio', id: 'list_audio' },
        { label: 'Get Audio', id: 'get_audio' },
        { label: 'List Live Events', id: 'list_live_events' },
      ],
      value: () => 'list_companies',
    },
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Quartr company ID (e.g., 4742)',
      condition: { field: 'operation', value: 'get_company' },
      required: true,
    },
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Quartr event ID (e.g., 128301)',
      condition: { field: 'operation', value: ['get_event', 'get_event_summary'] },
      required: true,
    },
    {
      id: 'summaryLength',
      title: 'Summary Length',
      type: 'dropdown',
      options: [
        { label: 'One Line', id: 'line' },
        { label: 'Short', id: 'short' },
        { label: 'Long', id: 'long' },
      ],
      value: () => 'short',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    {
      id: 'plainSummary',
      title: 'Plain Text Summary',
      type: 'switch',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: 'Quartr document ID of the report (e.g., 432907)',
      condition: { field: 'operation', value: 'get_report' },
      required: true,
    },
    {
      id: 'slideDeckId',
      title: 'Slide Deck ID',
      type: 'short-input',
      placeholder: 'Quartr document ID of the slide deck (e.g., 432907)',
      condition: { field: 'operation', value: 'get_slide_deck' },
      required: true,
    },
    {
      id: 'transcriptId',
      title: 'Transcript ID',
      type: 'short-input',
      placeholder: 'Quartr document ID of the transcript (e.g., 432907)',
      condition: { field: 'operation', value: 'get_transcript' },
      required: true,
    },
    {
      id: 'audioId',
      title: 'Audio ID',
      type: 'short-input',
      placeholder: 'Quartr audio ID (e.g., 123964)',
      condition: { field: 'operation', value: 'get_audio' },
      required: true,
    },
    {
      id: 'companyIds',
      title: 'Company IDs',
      type: 'short-input',
      placeholder: 'Comma-separated Quartr company IDs (e.g., 4742,128)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
    },
    {
      id: 'eventIds',
      title: 'Event IDs',
      type: 'short-input',
      placeholder: 'Comma-separated Quartr event IDs (e.g., 128301)',
      condition: { field: 'operation', value: EVENT_SCOPED_LIST_OPERATIONS },
    },
    {
      id: 'tickers',
      title: 'Tickers',
      type: 'short-input',
      placeholder: 'Comma-separated tickers (e.g., AAPL,MSFT)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
    },
    {
      id: 'isins',
      title: 'ISINs',
      type: 'short-input',
      placeholder: 'Comma-separated ISINs (e.g., US0378331005)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'ciks',
      title: 'CIKs',
      type: 'short-input',
      placeholder: 'Comma-separated SEC CIKs (e.g., 0000320193)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'openfigis',
      title: 'OpenFIGIs',
      type: 'short-input',
      placeholder: 'Comma-separated OpenFIGI codes (e.g., BBG001S5N8V8)',
      condition: { field: 'operation', value: 'list_companies' },
      mode: 'advanced',
    },
    {
      id: 'countries',
      title: 'Countries',
      type: 'short-input',
      placeholder: 'Comma-separated ISO country codes (e.g., US,SE)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'exchanges',
      title: 'Exchanges',
      type: 'short-input',
      placeholder: 'Comma-separated exchange symbols (e.g., NasdaqGS)',
      condition: { field: 'operation', value: COMPANY_SCOPED_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'eventTypeIds',
      title: 'Event Type IDs',
      type: 'short-input',
      placeholder: 'Comma-separated event type IDs (e.g., 26,27)',
      condition: { field: 'operation', value: 'list_events' },
    },
    {
      id: 'documentTypeIds',
      title: 'Document Type IDs',
      type: 'short-input',
      placeholder: 'Comma-separated document type IDs (e.g., 7,10)',
      condition: { field: 'operation', value: DOCUMENT_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'documentGroupIds',
      title: 'Document Group IDs',
      type: 'short-input',
      placeholder: '1=Earnings Release, 3=Interim Report, 4=Annual Report...',
      condition: { field: 'operation', value: DOCUMENT_LIST_OPERATIONS },
    },
    {
      id: 'states',
      title: 'Live States',
      type: 'short-input',
      placeholder: 'Comma-separated states (e.g., live,willBeLive)',
      condition: { field: 'operation', value: 'list_live_events' },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2024-01-01)',
      condition: { field: 'operation', value: DATE_RANGE_LIST_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2024-01-01) for the start of the requested range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2024-12-31)',
      condition: { field: 'operation', value: DATE_RANGE_LIST_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2024-12-31) for the end of the requested range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'transcriptVersion',
      title: 'Live Transcript Version',
      type: 'dropdown',
      options: [
        { label: '1.6', id: '1.6' },
        { label: '1.7', id: '1.7' },
      ],
      value: () => '1.6',
      condition: { field: 'operation', value: 'list_live_events' },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'ID', id: 'id' },
        { label: 'Date', id: 'date' },
      ],
      value: () => 'id',
      condition: { field: 'operation', value: 'list_events' },
      mode: 'advanced',
    },
    {
      id: 'expandEvent',
      title: 'Include Event Details',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [...DOCUMENT_LIST_OPERATIONS, 'list_audio'],
      },
      mode: 'advanced',
    },
    {
      id: 'updatedAfter',
      title: 'Updated After',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2024-01-01)',
      condition: { field: 'operation', value: UPDATED_RANGE_LIST_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2024-01-01) for filtering data updated after this date. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'updatedBefore',
      title: 'Updated Before',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2024-12-31)',
      condition: { field: 'operation', value: UPDATED_RANGE_LIST_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2024-12-31) for filtering data updated before this date. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: ALL_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from the previous response',
      condition: { field: 'operation', value: ALL_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: ALL_LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Quartr API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'quartr_list_companies',
      'quartr_get_company',
      'quartr_list_events',
      'quartr_get_event',
      'quartr_get_event_summary',
      'quartr_list_event_types',
      'quartr_list_documents',
      'quartr_list_document_types',
      'quartr_list_reports',
      'quartr_get_report',
      'quartr_list_slide_decks',
      'quartr_get_slide_deck',
      'quartr_list_transcripts',
      'quartr_get_transcript',
      'quartr_list_audio',
      'quartr_get_audio',
      'quartr_list_live_events',
    ],
    config: {
      tool: (params) => `quartr_${params.operation}`,
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Quartr API key' },
    companyId: { type: 'number', description: 'Quartr company ID' },
    eventId: { type: 'number', description: 'Quartr event ID' },
    summaryLength: { type: 'string', description: 'Summary length preset' },
    plainSummary: { type: 'boolean', description: 'Plain text summary without source tags' },
    reportId: { type: 'number', description: 'Quartr document ID of the report' },
    slideDeckId: { type: 'number', description: 'Quartr document ID of the slide deck' },
    transcriptId: { type: 'number', description: 'Quartr document ID of the transcript' },
    audioId: { type: 'number', description: 'Quartr audio ID' },
    companyIds: { type: 'string', description: 'Comma-separated Quartr company IDs' },
    eventIds: { type: 'string', description: 'Comma-separated Quartr event IDs' },
    tickers: { type: 'string', description: 'Comma-separated company tickers' },
    isins: { type: 'string', description: 'Comma-separated ISINs' },
    ciks: { type: 'string', description: 'Comma-separated SEC CIKs' },
    openfigis: { type: 'string', description: 'Comma-separated OpenFIGI codes' },
    countries: { type: 'string', description: 'Comma-separated ISO country codes' },
    exchanges: { type: 'string', description: 'Comma-separated exchange symbols' },
    eventTypeIds: { type: 'string', description: 'Comma-separated event type IDs' },
    documentTypeIds: { type: 'string', description: 'Comma-separated document type IDs' },
    documentGroupIds: { type: 'string', description: 'Comma-separated document group IDs' },
    states: { type: 'string', description: 'Comma-separated live states' },
    transcriptVersion: { type: 'string', description: 'Live transcript stream version' },
    startDate: { type: 'string', description: 'Start date filter (ISO 8601)' },
    endDate: { type: 'string', description: 'End date filter (ISO 8601)' },
    sortBy: { type: 'string', description: 'Field to sort events by' },
    expandEvent: { type: 'boolean', description: 'Include expanded event details' },
    updatedAfter: { type: 'string', description: 'Updated-after date filter (ISO 8601)' },
    updatedBefore: { type: 'string', description: 'Updated-before date filter (ISO 8601)' },
    limit: { type: 'number', description: 'Maximum number of items to return' },
    cursor: { type: 'number', description: 'Pagination cursor from the previous response' },
    direction: { type: 'string', description: 'Sort direction (asc or desc)' },
  },
  outputs: {
    companies: {
      type: 'array',
      description: 'Companies matching the filters',
      condition: { field: 'operation', value: 'list_companies' },
    },
    company: {
      type: 'json',
      description: 'The requested company',
      condition: { field: 'operation', value: 'get_company' },
    },
    events: {
      type: 'array',
      description: 'Events matching the filters',
      condition: { field: 'operation', value: 'list_events' },
    },
    event: {
      type: 'json',
      description: 'The requested event',
      condition: { field: 'operation', value: 'get_event' },
    },
    summary: {
      type: 'string',
      description:
        'AI-generated event summary in Markdown (includes embedded document source tags unless a plain-text summary is requested)',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    sources: {
      type: 'array',
      description: 'Source documents referenced by the summary',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    summaryId: {
      type: 'number',
      description: 'Quartr summary ID',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    summaryCreatedAt: {
      type: 'string',
      description: 'Summary creation timestamp (ISO 8601)',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    summaryUpdatedAt: {
      type: 'string',
      description: 'Summary last update timestamp (ISO 8601)',
      condition: { field: 'operation', value: 'get_event_summary' },
    },
    eventTypes: {
      type: 'array',
      description: 'Available event types',
      condition: { field: 'operation', value: 'list_event_types' },
    },
    documentTypes: {
      type: 'array',
      description: 'Available document types',
      condition: { field: 'operation', value: 'list_document_types' },
    },
    documents: {
      type: 'array',
      description: 'Documents matching the filters',
      condition: { field: 'operation', value: 'list_documents' },
    },
    reports: {
      type: 'array',
      description: 'Reports matching the filters',
      condition: { field: 'operation', value: 'list_reports' },
    },
    slideDecks: {
      type: 'array',
      description: 'Slide decks matching the filters',
      condition: { field: 'operation', value: 'list_slide_decks' },
    },
    transcripts: {
      type: 'array',
      description: 'Transcripts matching the filters',
      condition: { field: 'operation', value: 'list_transcripts' },
    },
    document: {
      type: 'json',
      description: 'Document metadata',
      condition: { field: 'operation', value: ['get_report', 'get_slide_deck', 'get_transcript'] },
    },
    fileUrl: {
      type: 'string',
      description: 'URL of the document file',
      condition: { field: 'operation', value: ['get_report', 'get_slide_deck', 'get_transcript'] },
    },
    file: {
      type: 'file',
      description: 'Downloaded document file stored in execution files',
      condition: { field: 'operation', value: ['get_report', 'get_slide_deck', 'get_transcript'] },
    },
    audioRecordings: {
      type: 'array',
      description: 'Audio recordings matching the filters',
      condition: { field: 'operation', value: 'list_audio' },
    },
    audio: {
      type: 'json',
      description: 'The requested audio recording',
      condition: { field: 'operation', value: 'get_audio' },
    },
    liveEvents: {
      type: 'array',
      description: 'Live events matching the filters',
      condition: { field: 'operation', value: 'list_live_events' },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      condition: { field: 'operation', value: ALL_LIST_OPERATIONS },
    },
  },
}

export const QuartrBlockMeta = {
  tags: ['data-analytics', 'enrichment', 'document-processing'],
  url: 'https://quartr.com',
  templates: [
    {
      icon: QuartrIcon,
      title: 'Quartr earnings call digest',
      prompt:
        'Create a scheduled workflow that lists yesterday’s Quartr events for my watchlist tickers, fetches the AI-generated summary for each event, and posts a digest with source links to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr transcript knowledge base',
      prompt:
        'Build a scheduled workflow that lists new Quartr earnings call transcripts for companies I follow, downloads each transcript file, and indexes the content into a knowledge base so agents can answer questions about past calls.',
      modules: ['scheduled', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research', 'knowledge-base'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr filing watcher',
      prompt:
        'Create a scheduled workflow that checks Quartr daily for new annual and interim reports from my portfolio companies, downloads each report PDF to Files, and emails me a summary of what was filed.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr slide deck analyst',
      prompt:
        'Build a workflow that fetches the latest Quartr slide deck for a given ticker, has an agent extract guidance, KPIs, and notable changes from the deck, and writes the analysis to a table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'productivity',
      tags: ['research', 'document-processing'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr live earnings monitor',
      prompt:
        'Create a scheduled workflow that polls Quartr live events for my watchlist, and when a company goes live, posts the live audio and transcript stream links to a Slack channel.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'events'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr competitor earnings tracker',
      prompt:
        'Build a workflow that reads competitor tickers from a table, lists each company’s recent Quartr events and event summaries, and logs revenue and guidance highlights back to the table for quarter-over-quarter comparison.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'sales'],
    },
    {
      icon: QuartrIcon,
      title: 'Quartr earnings Q&A agent',
      prompt:
        'Create an agent that answers questions about a company’s earnings by looking up the company on Quartr, finding its latest earnings call event, and grounding answers in the event summary and transcript.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'agentic'],
    },
  ],
  skills: [
    {
      name: 'summarize-earnings-call',
      description:
        'Find a company’s latest earnings call on Quartr and return its AI-generated summary with sources.',
      content:
        '# Summarize an Earnings Call\n\nTurn a ticker into a sourced summary of the company’s most recent earnings call.\n\n## Steps\n1. Use the List Companies operation with the ticker in Tickers to resolve the Quartr company ID.\n2. Use List Events with that ID in Company IDs, Sort By set to Date, and Sort Direction set to Descending to find the latest earnings event.\n3. Use Get Event Summary with the event ID. Pick Summary Length: One Line for a headline, Short for a digest, or Long for full detail.\n4. Keep Plain Text Summary off if you want the embedded source tags, and use the sources output to cite documents.\n\n## Output\nReturn the summary text followed by the event title, date, and the source document IDs it references.',
    },
    {
      name: 'download-earnings-transcript',
      description:
        'Download the structured transcript JSON for a company’s earnings call for downstream analysis.',
      content:
        '# Download an Earnings Call Transcript\n\nFetch a transcript with timestamps and speaker identification as a workflow file.\n\n## Steps\n1. Resolve the company with List Companies (ticker, ISIN, or CIK).\n2. Use List Transcripts with the company ID in Company IDs and a date range to find the right transcript document.\n3. Use Get Transcript with that document ID. The transcript JSON is downloaded and stored as an execution file.\n4. Pass the file to an agent or knowledge base to analyze paragraphs, sentences, timestamps, and speakers.\n\n## Output\nReturn the transcript file plus the document metadata (event title, fiscal period, and date).',
    },
    {
      name: 'fetch-latest-filings',
      description:
        'List a company’s recent filings and reports on Quartr and download the report PDFs.',
      content:
        '# Fetch the Latest Filings and Reports\n\nPull recent 10-Ks, 10-Qs, earnings releases, or annual reports for a company.\n\n## Steps\n1. Resolve the company with List Companies using its ticker or CIK.\n2. Use List Reports with the company ID in Company IDs. Narrow with Document Group IDs (1 = Earnings Release, 3 = Interim Report, 4 = Annual Report) or a date range.\n3. Use Get Report with each document ID to download the PDF into execution files.\n4. Optionally use List Document Types to map type IDs to filing forms like 10-Q.\n\n## Output\nReturn the report files with each document’s type, event, and filing date.',
    },
    {
      name: 'monitor-live-earnings',
      description:
        'Check which companies are live on Quartr right now and surface their audio and transcript streams.',
      content:
        '# Monitor Live Earnings Calls\n\nWatch for companies going live and grab their stream URLs.\n\n## Steps\n1. Use List Live Events with Live States set to live (or willBeLive to see what is coming up).\n2. Filter to your watchlist with Company IDs or Tickers.\n3. Read each live event’s state, audio stream URL, and transcript stream URL from the output.\n4. Run the workflow on a schedule and alert when a watched company’s state changes to live.\n\n## Output\nReturn the live companies with their event IDs, states, and audio/transcript stream URLs.',
    },
    {
      name: 'analyze-investor-slides',
      description:
        'Download a company’s latest investor presentation from Quartr and extract key takeaways.',
      content:
        '# Analyze an Investor Slide Deck\n\nGet the latest presentation PDF and have an agent extract what matters.\n\n## Steps\n1. Resolve the company with List Companies and find the relevant event with List Events.\n2. Use List Slide Decks with the event ID in Event IDs (or the company ID and a date range) to find the deck.\n3. Use Get Slide Deck with the document ID to download the PDF into execution files.\n4. Pass the file to an agent to extract guidance, KPIs, and notable changes.\n\n## Output\nReturn the slide deck file plus the extracted highlights.',
    },
  ],
} as const satisfies BlockMeta
