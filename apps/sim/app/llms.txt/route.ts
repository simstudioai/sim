import { getBaseUrl } from '@/lib/core/utils/urls'

export async function GET() {
  const baseUrl = getBaseUrl()

  const llmsContent = `# Sim

> Sim is an open-source AI agent workflow builder. 60,000+ developers at startups to Fortune 500 companies deploy agentic workflows on the Sim platform. SOC2 and HIPAA compliant.

Sim provides a visual drag-and-drop interface for building and deploying AI agent workflows. Connect to 100+ integrations and ship production-ready AI automations.

## Core Pages

- [Homepage](${baseUrl}): Main landing page with product overview and features
- [Templates](${baseUrl}/templates): Pre-built workflow templates to get started quickly
- [Changelog](${baseUrl}/changelog): Product updates and release notes
- [Sim Studio Blog](${baseUrl}/studio): Announcements, insights, and guides for AI workflows

## Documentation

- [Documentation](https://docs.sim.ai): Complete guides and API reference
- [Quickstart](https://docs.sim.ai/quickstart): Get started in 5 minutes
- [API Reference](https://docs.sim.ai/api): REST API documentation

## Key Concepts

- **Workspace**: Container for workflows, data sources, and executions
- **Workflow**: Directed graph of blocks defining an agentic process
- **Block**: Individual step (LLM call, tool call, HTTP request, code execution)
- **Trigger**: Event or schedule that initiates workflow execution
- **Execution**: A single run of a workflow with logs and outputs

## Capabilities

- Visual workflow builder with drag-and-drop canvas
- Multi-model LLM orchestration (OpenAI, Anthropic, Google, Mistral, xAI)
- Retrieval-augmented generation (RAG) with vector databases
- 100+ integrations (Slack, Gmail, Notion, Airtable, databases)
- Scheduled and webhook-triggered executions
- Real-time collaboration and version control

## Use Cases

- AI agent workflow automation
- RAG pipelines and document processing
- Chatbot and copilot workflows for SaaS
- Email and customer support automation
- Internal operations (sales, marketing, legal, finance)

## Links

- [GitHub Repository](https://github.com/simstudioai/sim): Open-source codebase
- [Discord Community](https://discord.gg/Hr4UWYEcTT): Get help and connect with users
- [X/Twitter](https://x.com/simdotai): Product updates and announcements

## Optional

- [Careers](${baseUrl}/careers): Join the Sim team
- [Terms of Service](${baseUrl}/terms): Legal terms
- [Privacy Policy](${baseUrl}/privacy): Data handling practices
`

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
