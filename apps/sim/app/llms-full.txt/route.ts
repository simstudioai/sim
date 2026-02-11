import { getBaseUrl } from '@/lib/core/utils/urls'

export async function GET() {
  const baseUrl = getBaseUrl()

  const llmsFullContent = `# Sim - AI Agent Workflow Builder

> Sim is an open-source AI agent workflow builder used by 60,000+ developers at startups to Fortune 500 companies. Build and deploy agentic workflows with a visual drag-and-drop canvas. SOC2 and HIPAA compliant.

## Overview

Sim provides a visual interface for building AI agent workflows. Instead of writing code, users drag and drop blocks onto a canvas and connect them to create complex AI automations. Each block represents a step in the workflow - an LLM call, a tool invocation, an API request, or a code execution.

## Product Details

- **Product Name**: Sim
- **Category**: AI Development Tools / Workflow Automation
- **Deployment**: Cloud (SaaS) and Self-hosted options
- **Pricing**: Free tier, Pro ($20/month), Team ($40/month), Enterprise (custom)
- **Compliance**: SOC2 Type II, HIPAA compliant

## Core Concepts

### Workspace
A workspace is the top-level container in Sim. It holds workflows, data sources, credentials, and execution history. Users can create multiple workspaces for different projects or teams.

### Workflow
A workflow is a directed graph of blocks that defines an agentic process. Workflows can be triggered manually, on a schedule, or via webhooks. Each workflow has a unique ID and can be versioned.

### Block
A block is an individual step in a workflow. Types include:
- **Agent Block**: Executes an LLM call with system prompts and tools
- **Function Block**: Runs custom JavaScript/TypeScript code
- **API Block**: Makes HTTP requests to external services
- **Condition Block**: Branches workflow based on conditions
- **Loop Block**: Iterates over arrays or until conditions are met
- **Router Block**: Routes to different paths based on LLM classification

### Trigger
A trigger initiates workflow execution. Types include:
- **Manual**: User clicks "Run" button
- **Schedule**: Cron-based scheduling (e.g., every hour, daily at 9am)
- **Webhook**: HTTP endpoint that triggers on incoming requests
- **Event**: Triggered by external events (email received, Slack message, etc.)

### Execution
An execution is a single run of a workflow. It includes:
- Input parameters
- Block-by-block execution logs
- Output data
- Token usage and cost tracking
- Duration and performance metrics

## Capabilities

### LLM Orchestration
Sim supports all major LLM providers:
- OpenAI (GPT-5.2, GPT-5.1, GPT-5, GPT-4o, GPT-4.1)
- Anthropic (Claude Opus 4.6, Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5)
- Google (Gemini Pro 3, Gemini Pro 3 Preview, Gemini 2.5 Pro, Gemini 2.5 Flash)
- Mistral (Mistral Large, Mistral Medium)
- xAI (Grok)
- Perplexity
- Ollama or VLLM (self-hosted open-source models) 
- Azure OpenAI
- Amazon Bedrock

### Integrations
100+ pre-built integrations including:
- **Communication**: Slack, Discord, Email (Gmail, Outlook), SMS (Twilio)
- **Productivity**: Notion, Airtable, Google Sheets, Google Docs
- **Development**: GitHub, GitLab, Jira, Linear
- **Data**: PostgreSQL, MySQL, MongoDB, Supabase, Pinecone
- **Storage**: AWS S3, Google Cloud Storage, Dropbox
- **CRM**: Salesforce, HubSpot, Pipedrive

### RAG (Retrieval-Augmented Generation)
Built-in support for:
- Document ingestion (PDF, DOCX, TXT, Markdown)
- Vector database integration (Pinecone, Weaviate, Qdrant)
- Semantic search and retrieval
- Chunking strategies (fixed size, semantic, recursive)

### Code Execution
- Sandboxed JavaScript/TypeScript execution
- Access to npm packages
- Persistent state across executions
- Error handling and retry logic

## Use Cases

### Customer Support Automation
- Classify incoming tickets by urgency and topic
- Generate draft responses using RAG over knowledge base
- Route to appropriate team members
- Auto-close resolved tickets

### Content Generation Pipeline
- Research topics using web search tools
- Generate outlines and drafts with LLMs
- Review and edit with human-in-the-loop
- Publish to CMS platforms

### Data Processing Workflows
- Extract data from documents (invoices, receipts, forms)
- Transform and validate data
- Load into databases or spreadsheets
- Generate reports and summaries

### Sales and Marketing Automation
- Enrich leads with company data
- Score leads based on fit criteria
- Generate personalized outreach emails
- Sync with CRM systems

## Technical Architecture

### Frontend
- Next.js 15 with App Router
- React Flow for canvas visualization
- Tailwind CSS for styling
- Zustand for state management

### Backend
- Node.js with TypeScript
- PostgreSQL for persistent storage
- Redis for caching and queues
- S3-compatible storage for files

### Execution Engine
- Isolated execution per workflow run
- Parallel block execution where possible
- Retry logic with exponential backoff
- Real-time streaming of outputs

## Getting Started

1. **Sign Up**: Create a free account at ${baseUrl}
2. **Create Workspace**: Set up your first workspace
3. **Build Workflow**: Drag blocks onto canvas and connect them
4. **Configure Blocks**: Set up LLM providers, tools, and integrations
5. **Test**: Run the workflow manually to verify
6. **Deploy**: Set up triggers for automated execution

## Links

- **Website**: ${baseUrl}
- **Documentation**: https://docs.sim.ai
- **API Reference**: https://docs.sim.ai/api
- **GitHub**: https://github.com/simstudioai/sim
- **Discord**: https://discord.gg/Hr4UWYEcTT
- **X/Twitter**: https://x.com/simdotai
- **LinkedIn**: https://linkedin.com/company/simstudioai

## Support

- **Email**: help@sim.ai
- **Security Issues**: security@sim.ai
- **Documentation**: https://docs.sim.ai
- **Community Discord**: https://discord.gg/Hr4UWYEcTT

## Legal

- **Terms of Service**: ${baseUrl}/terms
- **Privacy Policy**: ${baseUrl}/privacy
- **Security**: ${baseUrl}/.well-known/security.txt
`

  return new Response(llmsFullContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
