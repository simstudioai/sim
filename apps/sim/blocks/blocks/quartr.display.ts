import { QuartrIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const QuartrBlockDisplay = {
  type: 'quartr',
  name: 'Quartr',
  description: 'Access earnings calls, transcripts, filings, and slides',
  category: 'tools',
  bgColor: '#000000',
  icon: QuartrIcon,
  longDescription:
    'Integrate Quartr into the workflow. Look up public companies, corporate events, and event types; fetch AI-generated event summaries; list and download filings, reports, slide decks, and transcripts; and access archived audio and live event streams. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/quartr',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

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
