export async function GET() {
  const llmsContent = `# Sim - AI Agent Workflow Builder
Sim is an open-source AI agent workflow builder. Developers at trail-blazing startups to Fortune 500 companies deploy agentic workflows on the Sim platform.  
30,000+ developers are already using Sim to build and deploy AI agent workflows.  
Sim lets developers integrate with 100+ apps to streamline workflows with AI agents. Sim is SOC2 and HIPAA compliant, ensuring enterprise-level security.

## Key Features
- Visual Workflow Builder: Drag-and-drop interface for creating AI agent workflows
- [Documentation](https://docs.sim.ai): Complete guide to building AI agents

## Use Cases
- AI Agent Workflow Automation
- RAG Agents
- RAG Systesm and Pipline
- Chatbot Workflows
- Document Processing Workflows
- Customer Service Chatbot Workflows
- Ecommerce Agent Workflows
- Marketing Agent Workflows
- Deep Research Workflows
- Marketing Agent Workflows
- Real Estate Agent Workflows
- Financial Planning Agent Workflows
- Legal Agent Workflows

## Getting Started
- [Quick Start Guide](https://docs.sim.ai/quickstart)
- [GitHub](https://github.com/simstudioai/sim)

## Resources
- [GitHub](https://github.com/simstudioai/sim)`

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
