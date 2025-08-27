export async function GET() {
  const llmsContent = `# Sim - AI Agent Workflow Builder
Visual platform for building and deploying AI agent workflows

## Overview
Sim is a platform to build, prototype, and deploy AI agent workflows. It's the fastest-growing platform for building AI agent workflows.

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
