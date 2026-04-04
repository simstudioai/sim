import { getBaseUrl } from '@/lib/core/utils/urls'

export function GET() {
  const baseUrl = getBaseUrl()

  const content = `# Sim

> Sim is the open-source platform to build AI agents and run your agentic workforce. Connect integrations and LLMs to deploy and orchestrate agentic workflows.

Sim lets teams create agents, workflows, knowledge bases, tables, and docs. It supports both product discovery pages and deeper technical documentation.

## Preferred URLs

- [Homepage](${baseUrl}): Product overview and primary entry point
- [Integrations directory](${baseUrl}/integrations): Public catalog of integrations and automation capabilities
- [Models directory](${baseUrl}/models): Public catalog of AI models, pricing, context windows, and capabilities
- [Blog](${baseUrl}/blog): Announcements, guides, and product context
- [Changelog](${baseUrl}/changelog): Product updates and release notes

## Documentation

- [Documentation](https://docs.sim.ai): Product guides and technical reference
- [Quickstart](https://docs.sim.ai/quickstart): Fastest path to getting started
- [API Reference](https://docs.sim.ai/api): API documentation

## Key Concepts

- **Workspace**: Container for workflows, data sources, and executions
- **Workflow**: Directed graph of blocks defining an agentic process
- **Block**: Individual step such as an LLM call, tool call, HTTP request, or code execution
- **Trigger**: Event or schedule that initiates workflow execution
- **Execution**: A single run of a workflow with logs and outputs
- **Knowledge Base**: Document store used for retrieval-augmented generation

## Capabilities

- AI agent creation and deployment
- Agentic workflow orchestration
- Integrations across business tools, databases, and communication platforms
- Multi-model LLM orchestration
- Knowledge bases and retrieval-augmented generation
- Table creation and management
- Document creation and processing
- Scheduled and webhook-triggered executions

## Use Cases

- AI agent deployment and orchestration
- Knowledge bases and RAG pipelines
- Customer support automation
- Internal operations workflows across sales, marketing, legal, and finance

## Additional Links

- [GitHub Repository](https://github.com/simstudioai/sim): Open-source codebase
- [Docs](https://docs.sim.ai): Canonical documentation source
- [Terms of Service](${baseUrl}/terms): Legal terms
- [Privacy Policy](${baseUrl}/privacy): Data handling practices
- [Sitemap](${baseUrl}/sitemap.xml): Public URL inventory
`

  return new Response(content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
