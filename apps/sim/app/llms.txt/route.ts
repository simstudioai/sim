export async function GET() {
  const llmsContent = `# Sim - AI Agent Workflow Builder
Sim is an open-source AI agent workflow builder for production workflows. Developers at trail-blazing startups to Fortune 500 companies deploy agentic workflows on the Sim platform. 50,000+ developers already use Sim to build and ship AI automations with 100+ integrations. Sim is SOC2 and HIPAA compliant and is designed for secure, enterprise-grade AI automation.

Website: https://sim.ai
App: https://sim.ai/workspace
Docs: https://docs.sim.ai
GitHub: https://github.com/simstudioai/sim
Region: global
Primary language: en

## Capabilities
- Visual workflow builder for multi-step AI agents and tools
- Orchestration of LLM calls, tools, webhooks, and external APIs
- Scheduled and event-driven agent executions
- First-class support for retrieval-augmented generation (RAG)
- Multi-tenant, workspace-based access model

## Ideal Use Cases
- AI agent workflow automation
- RAG agents and retrieval pipelines
- Chatbot and copilot workflows for SaaS products
- Document and email processing workflows
- Customer support, marketing, and growth automations
- Internal operations automations (ops, finance, legal, sales)

## Key Entities
- Workspace: container for workflows, data sources, and executions
- Workflow: directed graph of blocks defining an agentic process
- Block: individual step (LLM call, tool call, HTTP request, code, etc.)
- Schedule: time-based trigger for running workflows
- Execution: a single run of a workflow

## Getting Started
- Quickstart: https://docs.sim.ai/quickstart
- Product overview: https://docs.sim.ai
- Source code: https://github.com/simstudioai/sim

## Safety & Reliability
- SOC2 and HIPAA aligned security controls
- Audit-friendly execution logs and cost tracking
- Fine-grained control over external tools, APIs, and data sources
`

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
