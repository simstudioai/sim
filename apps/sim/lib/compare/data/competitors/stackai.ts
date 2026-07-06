import { StackAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const stackaiProfile: CompetitorProfile = {
  id: 'stack-ai',
  name: 'StackAI',
  website: 'https://www.stackai.com',
  brand: {
    icon: StackAIIcon,
    selfFramed: true,
    colors: ['#8c8c8c', '#212121', '#d0d0d0'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'StackAI is a proprietary, enterprise-focused visual platform for building, deploying, and governing AI agents, connecting LLMs and business systems through a drag-and-drop, low-code node builder.',
  standoutFeatures: [
    {
      title: 'ISO 27001 certified, with a public Trust Center detailing pen tests and DPAs',
      description:
        'StackAI publishes a Trust Center (trust.stackai.com) documenting ISO 27001 certification (alongside its SOC 2 Type II audit), third-party penetration test results, and DPAs with OpenAI and Anthropic.',
      shortDescription: 'Public Trust Center with ISO 27001, pen test results, and DPAs.',
      source: {
        url: 'https://trust.stackai.com/',
        label: 'StackAI Trust Center',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'PR-gated approval workflow for promoting agents between environments',
      description:
        'StackAI provides three default, isolated environments (development, staging, production), plus custom environments. Promotion between them requires a pull request that must be reviewed and approved, with an admin approval queue sitting before production deploys. Sim also supports forking a workspace into dev/qa/prod-style environments with diff and promote/rollback, but without a mandatory PR-review or approval gate.',
      shortDescription: 'PR-gated dev/staging/production promotion with admin approval queues.',
      source: {
        url: 'https://www.stackai.com/blog/the-agentic-development-life-cycle-how-to-manage-ai-agents-at-scale',
        label: 'The Agentic Development Life Cycle - StackAI blog',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Full version diff/compare on every manual edit, not just AI-generated changes',
      description:
        'Every save creates a full version snapshot of an agent, regardless of whether the change was made manually or by an AI assistant. A comparison tool shows added or removed nodes, prompt and LLM config changes, and connection changes. Any version can be reverted, and reverting creates a new version rather than erasing history. Sim diffs and reverts Copilot-generated edits, but manual edits only get local undo/redo, not a versioned diff.',
      shortDescription: 'Full version snapshots with diff/compare and one-click rollback.',
      source: {
        url: 'https://www.stackai.com/blog/the-agentic-development-life-cycle-how-to-manage-ai-agents-at-scale',
        label: 'The Agentic Development Life Cycle - StackAI blog',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'On-prem / VPC self-hosted deployment for enterprise',
      description:
        "The Enterprise plan supports on-premise or VPC deployment behind the customer's own VPN/network, alongside dedicated infrastructure and SSO/access controls.",
      shortDescription: 'Enterprise-only on-prem or VPC deployment with dedicated infrastructure.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Not open source',
      description:
        'StackAI is a proprietary, closed-source commercial SaaS platform. Its GitHub organization contains only auxiliary tools and integrations, not the core platform, so there is no self-hostable OSS codebase to audit or fork.',
      shortDescription: 'Closed-source SaaS with no auditable or forkable codebase.',
      source: {
        url: 'https://github.com/stackai',
        label: 'StackAI GitHub organization',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Free tier is very limited',
      description:
        'The free plan caps usage at 500 runs/month, 2 projects, and 1 seat, with support limited to community Discord, well below what a team evaluating agent workflows at scale would need.',
      shortDescription: 'Free plan caps at 500 runs, 2 projects, 1 seat.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No published self-serve/mid-tier pricing',
      description:
        'Beyond the free tier, StackAI publishes only a custom-quote Enterprise plan with no mid-market tier, so cost comparison requires contacting sales.',
      shortDescription: 'No mid-tier pricing. Only free or a custom Enterprise quote.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'HIPAA/GDPR not documented on the Trust Center itself',
      description:
        'The public Trust Center page lists only SOC 2 Type II and ISO 27001. A separate blog post confirms StackAI was also audited against HIPAA, but GDPR compliance appears only on marketing/pricing pages (e.g. "SOC 2, HIPAA & GDPR compliance" on the Enterprise tier), with no dedicated audit evidence.',
      shortDescription:
        'HIPAA is audited but GDPR compliance is undocumented outside marketing pages.',
      source: {
        url: 'https://trust.stackai.com/',
        label: 'StackAI Trust Center',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual/low-code node-based workflow builder',
        detail:
          'Drag-and-drop canvas of nodes (LLM, tools, logic, multimodal) for building agents; also supports Python code nodes for custom logic.',
        shortValue: 'Drag-and-drop nodes plus Python code nodes',
        confidence: 'verified',
        sources: [
          { url: 'https://docs.stackai.com/', label: 'StackAI Docs Overview', asOf: '2026-07-02' },
          {
            url: 'https://docs.stackai.com/logic/python-code',
            label: 'Python Code node - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value: 'Yes, on the Enterprise plan only',
        detail:
          "On-premise or VPC deployment, entirely within the customer's own VPC and behind their own VPN, is offered as part of the custom-priced Enterprise tier. Not available on the free tier.",
        shortValue: 'Enterprise-only, VPC or on-prem',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
          {
            url: 'https://www.stackai.com/solutions/self-hosted',
            label: 'StackAI Self-Hosted Solutions page',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value: 'Cloud SaaS, VPC/on-prem (Enterprise), plus an AWS Marketplace listing',
        detail:
          'Agents deploy to chat, forms, APIs, Slack, Teams, or batch run; also listed on AWS Marketplace as "StackAI Hosted".',
        shortValue: 'Cloud, VPC/on-prem, AWS Marketplace',
        confidence: 'verified',
        sources: [
          {
            url: 'https://aws.amazon.com/marketplace/pp/prodview-p6pd4dwnmgyew',
            label: 'StackAI Hosted - AWS Marketplace',
            asOf: '2026-07-02',
          },
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      templates: {
        value: 'Yes, template library across business functions',
        detail:
          'Pre-built templates for finance/compliance, business operations, customer service/support, sales, and more.',
        shortValue: 'Templates across business functions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/templates',
            label: 'Customizable AI Workflow Templates - StackAI',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary / closed source',
        detail:
          'Commercial SaaS platform; the GitHub org (github.com/stackai) contains only auxiliary repos, not the core platform.',
        shortValue: 'Closed-source commercial SaaS',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/stackai',
            label: 'StackAI GitHub organization',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: full dev/staging/production workspace promotion with PR-gated approval',
        detail:
          'Three default isolated environments (development, staging, production), each independently connectable to different data sources/APIs; changes flow via pull requests that must be reviewed and approved before promotion, with a central admin approval queue. Custom environments (QA, experimentation, demo, client-specific) can be added.',
        shortValue: 'Dev/staging/prod with PR-gated promotion',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/blog/the-agentic-development-life-cycle-how-to-manage-ai-agents-at-scale',
            label: 'The Agentic Development Life Cycle - StackAI blog',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Version history with diff/compare and rollback via revert; no branching or client-side undo/redo',
        detail:
          'Every save creates a full version snapshot; a compare tool diffs nodes, prompts/LLM config, and connections between versions. Any version can be reverted, which creates a new version and preserves history.',
        shortValue: 'Version history, diff, and rollback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/blog/the-agentic-development-life-cycle-how-to-manage-ai-agents-at-scale',
            label: 'The Agentic Development Life Cycle - StackAI blog',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Unknown: a third-party review mentions "real-time collaboration features," but StackAI\'s own documentation does not confirm live, concurrent multi-user editing (synced cursors, selections, live edits) on the same workflow canvas.',
        detail:
          'StackAI documents workspace and folder sharing with role-based access to projects. That is async collaboration, not verified simultaneous co-editing with presence indicators.',
        shortValue: 'Unknown, not confirmed in official docs',
        confidence: 'unknown',
        sources: [],
      },
      nativeFileStorage: {
        value:
          'No: the Files node is a per-workflow input for uploading a document as context for the LLM, not a persistent file store. Ongoing file access goes through Knowledge Base connectors to external storage like Google Drive, Dropbox, OneDrive, SharePoint, Box, S3, or Azure Blob. There is no native file system with its own folder hierarchy, link-based sharing, or a trash/recovery feature.',
        detail:
          'Workspace "folders" that exist in StackAI docs organize projects/permissions, not user files.',
        shortValue: 'No, relies on external storage connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/inputs/files-node',
            label: 'Files Node docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/governance-and-security/workspace-and-folder-access',
            label: 'Workspace and Folder Access docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: the Table node lets a workflow upload a CSV or XLSX file and query it with LLM-generated SQL, but only as a one-off input to that workflow run. That's different from a persistent, spreadsheet-like data table shared across a workspace, with defined row/column limits and spreadsheet-style keyboard navigation.",
        detail:
          'There is no standalone "Tables" product surface with persistent grid storage independent of a single workflow run.',
        shortValue: 'No, only per-workflow CSV analysis',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/blog/how-to-build-spreadsheet-ai-agent',
            label: 'Build Spreadsheet AI Agent blog',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: StackAI has no documented inline rich-text or WYSIWYG markdown editor for documents stored in the platform. Other search results turned up only unrelated third-party products with similar names.',
        shortValue: 'Unknown, not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          "Yes: an AI Agent node can invoke a separately saved StackAI workflow as a Subflow Tool. The parent agent passes input into the subflow, waits for it to run to completion, and receives the subflow's output node result back before continuing, rather than only firing an async webhook-triggered run.",
        detail:
          'Subflow Tools are configured on the AI Agent node; each must connect to an output node to complete, and the docs describe subflows running "collaboratively" where one subflow\'s output can inform whether/how another is invoked. Whether a Subflow Tool can be reused unmodified across multiple parent workflows is unconfirmed.',
        shortValue: 'Yes, via Subflow Tools on the AI Agent node',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/subflow-tools',
            label: 'Subflow Tools docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Yes, broad support across major LLM providers',
        detail:
          'The LLM node is provider-agnostic with a model dropdown, and StackAI docs confirm OpenAI models directly and via Azure hosting, plus AWS Bedrock-hosted models including Anthropic Claude, AI21, Cohere, and Amazon Titan. StackAI also documents data processing agreements with OpenAI and Anthropic.',
        shortValue: 'Broad LLM provider support',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/llm-hosting-and-governance/llms-hosted-on-azure-and-aws-bedrock',
            label: 'LLMs Hosted on Azure & AWS Bedrock - StackAI Docs',
            asOf: '2026-07-04',
          },
          {
            url: 'https://trust.stackai.com/',
            label: 'StackAI Trust Center (OpenAI/Anthropic DPAs)',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      naturalLanguageBuilding: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      knowledgeBaseRag: {
        value: 'Yes: knowledge base / data loader connections',
        detail:
          'Connects to knowledge bases, tools, and business systems; the Enterprise plan includes all data loaders.',
        shortValue: 'Knowledge base and data loader nodes',
        confidence: 'verified',
        sources: [
          { url: 'https://docs.stackai.com/', label: 'StackAI Docs Overview', asOf: '2026-07-02' },
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      mcpSupport: {
        value: 'Yes: dedicated MCP node',
        detail:
          'An MCP node lets a workflow call a tool on a Model Context Protocol server, using public servers via URL connection or self-hosted/local MCP servers exposed via a tunnel (e.g. ngrok) for advanced users.',
        shortValue: 'Dedicated MCP node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'MCP - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Retrieval grounding, tool-call validation, and output enforcement are covered in vendor guidance, but there is no dedicated first-party evaluation or guardrails feature.',
        shortValue: 'Guardrail guidance, no dedicated product',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/insights/how-to-design-ai-agent-guardrails-best-practices-for-input-validation-output-filtering-and-safety-controls',
            label: 'How to Design AI Agent Guardrails - StackAI insights',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: dedicated pause-and-approve mechanism distinct from a simple delay step',
        detail:
          'A workflow pauses at a decision point and sends an approval request via Slack, Teams, email, or another connected channel. A human reviewer can approve, reject, or give feedback, and the gated action, such as sending an email, writing to a database, or provisioning access, only executes after approval. This checkpoint reduces the damage a hallucination or a mistaken tool call could cause.',
        shortValue: 'Pause-and-approve checkpoint before side effects',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/blog/introducing-stackai-human-in-the-loop-agentic-workflows-you-can-trust',
            label: 'Introducing StackAI Human-in-the-Loop - StackAI blog',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes: image and audio generation nodes; no dedicated video generation node',
        detail:
          'A Text-to-Audio node uses ElevenLabs for TTS and voice cloning; an Image node generates images from text prompts using models such as OpenAI DALL·E 3 or Stable Diffusion.',
        shortValue: 'Image and audio nodes, no video',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/outputs/image-node',
            label: 'Image Node - StackAI Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/outputs/audio-node',
            label: 'Audio Node - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Yes, but proprietary and platform-locked: a Prompt Library where builders save and reuse named prompts/instructions (e.g. a saved "Market Analyst Persona") across agents, rather than re-writing a one-off system prompt each time.',
        detail:
          "Documented as a prompt/instruction library stored inside a StackAI workspace, not an open, portable file format. StackAI's docs do not describe exporting a saved prompt as a standalone file or importing one from an external source or repository URL, the way some competitors build reusable skills on an open, version-controllable format. There is also no documented progressive-disclosure loading mechanism (only a short name/description surfaced until needed); the full prompt appears to load in full whenever it's attached.",
        shortValue: 'Yes, but a proprietary Prompt Library, not an open/portable format',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/other-views/prompt-library',
            label: 'Prompt Library docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: builders can publish a workflow or agent as a hosted Chat Assistant interface, alongside form, batch run, Slack, Teams, and API deployment targets. A chat widget can also be embedded on external sites via a copy-paste snippet.',
        shortValue: 'Yes, native chat + embeddable widget',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'Platform Overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/getting-started/start-here',
            label: 'Start Here',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: StackAI's Knowledge Base nodes return retrieved chunks and let builders configure the chunking algorithm, chunk length, and chunk overlap. An output-format toggle switches between chunks, pages, and full documents, and a document preview view lets builders inspect indexed content.",
        detail:
          'Confirms chunk-level granularity is exposed (algorithm, length, overlap, chunk vs page vs doc output). A dedicated chunk-index debugging pane beyond the document preview is unconfirmed.',
        shortValue: 'Yes, chunk-level config and output',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/best-practices/chunking',
            label: 'Chunking docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/knowledge-base',
            label: 'Knowledge Base docs',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          "Partial: StackAI's core workflow builder is built around sequential and conditional (If/Else) branching rather than a dedicated deterministic fan-out/fan-in node. Concurrent execution shows up at the AI Agent node level, where the agent can call multiple Subflow Tools in parallel (e.g., checking several independent systems at once) and StackAI Project nodes can run in parallel under loop mode.",
        detail:
          'There is no standalone "split into parallel paths" or "parallel branches" node in the core logic node set (If/Else, Loop Subflow). Parallelism instead comes from agent-driven concurrent tool calls or parallel sub-project execution inside a loop, a narrower mechanism than a general-purpose fan-out/fan-in workflow node.',
        shortValue: 'Partial, via parallel tool calls and loop mode',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/subflow-tools',
            label: 'Subflow Tools docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/loop-subflow',
            label: 'Loop Subflow docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/if-else-node',
            label: 'If/Else Node docs',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "No: StackAI's documentation, changelog, and blog do not mention the Agent2Agent (A2A) protocol or Agent Cards.",
        detail:
          'StackAI documents MCP-style tool integration and Subflow Tools/StackAI Project nodes for composing agents, but nothing references the A2A open standard.',
        shortValue: 'Not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com',
            label: 'StackAI documentation',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: the Loop Subflow node iterates over a list of inputs, running its Loop branch once per item sequentially, with the current item exposed via a current_item variable. A separate Done branch runs once after all iterations finish, collecting any outputs explicitly emitted inside the loop.',
        detail:
          'This is a sequential, one-item-at-a-time iterator distinct from the parallel/concurrent execution StackAI exposes separately through parallel Subflow Tool calls or parallel Project runs inside a loop.',
        shortValue: 'Yes, via the Loop Subflow node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/loop-subflow',
            label: 'Loop Subflow docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '70+ enterprise integrations',
        detail:
          'StackAI documentation states it connects to 70+ apps and services, including Notion, Airtable, AWS, BigQuery, GitHub, Google Workspace, HubSpot, MongoDB, and MCP. Some marketing pages cite a higher "100+" figure, but the documented apps list supports 70+.',
        shortValue: '70+ integrations',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps',
            label: 'StackAI Apps documentation (70+ apps and services)',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Scheduled/time-based triggers and outbound webhook calls (e.g., to Make); no native inbound webhook trigger node',
        detail:
          'Supports scheduled workflows (daily/weekly/monthly automation) and a Make node that can POST to trigger a Make.com scenario. Deployment surfaces include chat, forms, API, Slack, Teams, and batch run.',
        shortValue: 'Scheduled triggers, outbound webhooks only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/insights/how-to-set-up-scheduled-ai-workflows-and-automated-reports-on-stackai',
            label: 'Scheduled AI Workflows - StackAI insights',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/make',
            label: 'Make node - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Python code node',
        detail: 'A dedicated Python Code node allows custom logic within workflows.',
        shortValue: 'Python code node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/logic/python-code',
            label: 'Python Code - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: workflows publishable as a REST API with generated client snippets',
        detail:
          'Any flow can be exported and published as an API. Docs provide request snippets in Python, JavaScript, and cURL, with OAuth2-token authentication and a separate API reference.',
        shortValue: 'Publish workflows as REST APIs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/export-options/api',
            label: 'API - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Client code snippets only (Python, JavaScript, cURL); no installable SDK package, plugin/custom-node dev kit, or community integration marketplace',
        detail:
          "Docs provide request snippets for calling a published flow's API, but there's no distributable SDK package, documented custom-node/plugin SDK, or marketplace of community-built integrations.",
        shortValue: 'Code snippets only, no SDK or marketplace',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/export-options/api',
            label: 'API - StackAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: StackAI provides a hosted MCP server (mcp.stack.ai/mcp) and an open-source stack-ai-mcp server. Either lets external MCP-compatible clients, such as Claude Desktop, run a published StackAI workflow as a callable MCP tool, passing inputs in and getting structured results back.',
        shortValue: 'Yes, publishes workflows as MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'MCP node docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/blog/how-to-use-the-stack-ai-mcp-server',
            label: 'How to Use the Stack AI MCP Server',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Freemium + custom-quote Enterprise tier, metered by monthly runs/projects/seats',
        shortValue: 'Freemium plus custom Enterprise quote',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      entryPaidPlan: {
        value: 'No self-serve paid tier. Only Free and custom-quote Enterprise',
        detail:
          'The pricing page shows only "Free" ($0/mo) and "Enterprise" (custom pricing); there is no self-serve paid mid-tier.',
        shortValue: 'No mid-tier, Enterprise is quote-only',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      freeTier: {
        value: 'Yes: 500 runs/month, 2 projects, 1 seat, community Discord support',
        shortValue: '500 runs/mo, 2 projects, 1 seat',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II, audited by Modern Assurance',
        shortValue: 'SOC 2 Type II certified',
        confidence: 'verified',
        sources: [
          { url: 'https://trust.stackai.com/', label: 'StackAI Trust Center', asOf: '2026-07-02' },
          {
            url: 'https://www.stackai.com/blog/soc2-type2-hipaa',
            label: 'StackAI SOC 2 Type II & HIPAA blog',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      rbac: {
        value:
          'Access controls and SSO on the Enterprise plan; least-privilege access to customer data internally',
        detail:
          'The Enterprise plan includes access control and SSO. The Trust Center states customer-data access is restricted on a least-privilege basis with unique personnel IDs and controlled non-console production access.',
        shortValue: 'Enterprise SSO plus least-privilege access',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
          { url: 'https://trust.stackai.com/', label: 'StackAI Trust Center', asOf: '2026-07-02' },
        ],
      },
      auditLogging: {
        value:
          'Yes: automatic logs of every run, capturing input/output, token usage, and runtime, queryable through a pull-based Analytics API (filterable by run ID, status, user, and date range)',
        detail:
          'The Analytics API is request/response only: a builder calls it to list flow runs or an org-level run summary. There is no documented continuous push/export of these logs to an external destination such as S3, BigQuery, Datadog, or a generic webhook sink, and no separate public audit-log API distinct from execution logs.',
        shortValue: 'Automatic per-run logs via a pull-based API, no export destination',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI Platform Overview docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/analytics.md',
            label: 'StackAI API Reference: Analytics',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'ISO 27001 certified, and audited against HIPAA in the same review cycle as its SOC 2 Type II audit, though the public Trust Center page itself lists only SOC 2 and ISO 27001, not HIPAA',
        detail:
          'The Trust Center confirms SOC 2 Type II and ISO 27001, DPAs with OpenAI and Anthropic, and a May 2025 penetration test with a Low risk rating. A separate StackAI blog post states the company "was also audited against HIPAA standards during the same period as the SOC 2 Type II audit." GDPR compliance is referenced on the Enterprise pricing page but has no dedicated audit source.',
        shortValue: 'ISO 27001 certified; HIPAA audited, GDPR marketing-only',
        confidence: 'estimated',
        sources: [
          { url: 'https://trust.stackai.com/', label: 'StackAI Trust Center', asOf: '2026-07-02' },
          {
            url: 'https://www.stackai.com/blog/soc2-type2-hipaa',
            label: 'StackAI SOC 2 Type II & HIPAA blog',
            asOf: '2026-07-02',
          },
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Yes: owners and admins can share a connection org-wide or restrict it to specific users or groups, separately from the four-tier role system (Admin, Editor, User, Viewer). StackAI recommends pairing private folders with restricted connections and knowledge bases for sensitive workflows.',
        shortValue: 'Yes, per-connection user/group restriction',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/governance-and-security/workspace-and-folder-access',
            label: 'Workspace and Folder Access docs',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Unknown: StackAI does not document letting customers replace its logo, product name, or theme colors across the workspace or deployed-app UI. Deployed chat interfaces can be styled/branded, but full workspace-level white-labeling is unconfirmed.',
        detail:
          "Marketing pages reference brand guidelines for StackAI's own brand, and chat widgets can be styled to match a customer's site, but no source confirms full white-label replacement of vendor branding.",
        shortValue: 'Unknown, not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataRetention: {
        value:
          "Yes: StackAI's Trust Center and security documentation state the org can configure data retention durations, backed by a documented Data Retention and Disposal Policy, rather than a single fixed platform-wide default.",
        detail:
          'Public sources describe the policy existing and retention being settable, but exact granularity (per-resource-type controls like execution logs vs soft-deleted items separately) was not independently confirmed.',
        shortValue: 'Yes, configurable retention windows',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.stackai.com/',
            label: 'StackAI Trust Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/security-and-privacy',
            label: 'Security & Privacy docs',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "Yes: StackAI's security page states that built-in mechanisms detect and mask personally identifiable information (PII) during processing. Its guardrails guidance also covers redacting PII in inputs, retrieval, and logs as part of enterprise agent design.",
        shortValue: 'Yes, built-in PII detection/masking',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/security',
            label: 'StackAI Security page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/insights/how-to-design-ai-agent-guardrails-best-practices-for-input-validation-output-filtering-and-safety-controls',
            label: 'AI Agent Guardrails guide',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: StackAI supports Single Sign-On through a dedicated SSO settings page, integrating with identity providers like Okta and Entra ID to inherit groups and permissions. Newly provisioned SSO users get a default role, and admins can require SSO for all interfaces org-wide.',
        detail:
          'Docs confirm SSO login and default-role auto-provisioning behavior. SAML vs OIDC protocol details are not specified beyond the Okta/Entra ID integration.',
        shortValue: 'Yes, SSO with Okta/Entra ID',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/sso',
            label: 'StackAI SSO login page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/insights/sso-and-rbac-for-ai-agents-how-to-secure-enterprise-ai-deployments',
            label: 'SSO and RBAC for AI Agents',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: StackAI's 70+ app integrations (databases, cloud storage, CRMs, communication tools) are built and maintained by StackAI's own team, not an open community marketplace. Users needing an unlisted service fall back to a built-in Custom API node or connect their own MCP servers, rather than installing code published by other third-party users.",
        detail:
          'There is no public marketplace or community-node registry (like n8n community nodes) where outside developers publish installable integrations for other StackAI users. MCP support lets a workspace point at third-party MCP servers, but that is a user-configured connection to an external server the user chooses, not a shared plugin store with lighter vendor review. No StackAI-specific security incident involving its integrations or MCP connections appears in public sources.',
        shortValue: 'Yes, first-party catalog only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps',
            label: 'StackAI Apps documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'StackAI MCP documentation',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Analytics dashboard with usage graphs and per-run execution logs; no dedicated span-level distributed tracing UI',
        detail:
          'An Analytics section shows workflow usage graphs and a full list of execution logs (input/output, token usage, runtime performance). There is no granular per-step span tracing for individual tool-call/LLM-call spans within a run.',
        shortValue: 'Usage dashboard and run logs, no span tracing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI Platform Overview docs',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value: 'Unknown',
        detail:
          'No documented automatic retries, checkpointing, or replay of past executions with original inputs.',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value: 'Unknown',
        detail:
          'No documented proactive failure or threshold alerting; only after-the-fact execution logs are available.',
        shortValue: 'No proactive alerting documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Unknown: StackAI does not document continuous export of execution, audit, or usage data to an external destination such as S3, BigQuery, Datadog, or a generic webhook sink. Only per-run API access and project export/import are documented.',
        detail:
          'Docs cover an API export view (calling a flow via POST) and project export/import, which are pull/one-shot mechanisms, not a continuous log-drain feature.',
        shortValue: 'Unknown, not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      asyncExecution: {
        value:
          "Partial: StackAI's Analytics API can list and filter runs by ID and by status (including pending, paused, resumed, completed, failed, and cancelled) after the fact, which supports a trigger-then-check-later pattern. But StackAI's docs don't describe an official async-trigger-plus-poll workflow for actually running a flow, the way some platforms document a job-queue API.",
        detail:
          "The API used to run a flow only documents a request/response call that waits for the result, with no explicit async job or webhook pattern. The separate Analytics API exposes a run ID and status field, including a pending state, that can be queried after submission, showing a run's status can be checked later, though this is inferred from the analytics endpoint rather than a documented async execution feature.",
        shortValue: 'Partial: run status queryable later, no documented async API',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/run-flow.md',
            label: 'StackAI API Reference: Run Flow',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/analytics.md',
            label: 'StackAI API Reference: Analytics (run state/run_id)',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Partial: the only concrete published number is a usage quota, not a timeout or concurrency limit. The Free plan caps usage at 500 runs per month (2 projects, 1 seat), while Enterprise plans get custom or unlimited run allowances. No public documentation states a maximum single-execution duration or a cap on concurrent executions.',
        detail:
          "Neither the pricing page nor the API reference pages disclose a per-request timeout or a concurrent-execution cap. This is a gap in StackAI's public documentation, not a confirmed absence of limits.",
        shortValue: '500 runs/month on Free tier; no published timeout/concurrency',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing (500 runs/month on Free plan)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference.md',
            label: 'StackAI API Reference index (no rate/timeout limits listed)',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: each node can have a 'Fallback Branch' (On Error) that, when enabled, lets the workflow keep going after that node fails instead of halting the whole run. It routes execution to an alternate path, such as returning a safe message, emitting a structured error, or notifying a human.",
        detail:
          "StackAI's documentation also describes a complementary 'Retry on Failure' setting (configurable max retries and retry interval) and an LLM Fallback Mode, and recommends layering them: retries first, then an LLM fallback, then the fallback branch.",
        shortValue: 'Yes, via node-level Fallback Branch / On Error',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/guides-and-tips/stackai-hacks/handling-errors-and-fallback.md',
            label: 'StackAI: Handling Errors & Fallback (Fallback Branch, Retry on Failure)',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: StackAI is a multi-tenant cloud SaaS (each org gets an isolated partition on shared AWS/Azure/GCP infrastructure, or a dedicated VPC/on-prem deployment on Enterprise), and scheduled, chat, form, Slack, Teams, and API-triggered runs are executed and logged (runtime, tokens, input/output) through that hosted infrastructure rather than a builder's own machine.",
        detail:
          "StackAI's docs do not use explicit language like 'no client device dependency' the way some competitors do; this is inferred from its documented deployment model (cloud SaaS or Enterprise VPC/on-prem) and its scheduled-workflow and execution-log features, none of which describe or require a desktop app, browser tab, or local session staying open.",
        shortValue: 'Yes, inferred from its hosted SaaS/VPC execution model',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.stackai.com/solutions/self-hosted',
            label: 'StackAI Self-Hosted Solutions page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/insights/how-to-set-up-scheduled-ai-workflows-and-automated-reports-on-stackai',
            label: 'Scheduled AI Workflows - StackAI insights',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community Discord (free tier); dedicated solution engineers / forward-deployed engineers (Enterprise)',
        shortValue: 'Discord free, dedicated engineers on Enterprise',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/pricing', label: 'StackAI Pricing', asOf: '2026-07-02' },
        ],
      },
      sla: {
        value: 'Enterprise plans include support SLAs; exact terms are not publicly documented',
        shortValue: 'Enterprise SLAs, terms undisclosed',
        confidence: 'estimated',
        sources: [],
      },
      community: {
        value:
          'Discord community, comprehensive docs, and a StackAI Academy with tutorials and courses',
        shortValue: 'Discord, docs, and StackAI Academy',
        confidence: 'verified',
        sources: [
          { url: 'https://www.stackai.com/academy', label: 'StackAI Academy', asOf: '2026-07-02' },
        ],
      },
      companyMaturity: {
        value:
          'Acquired by Asana in a deal worth approximately $75 million, announced May 28, 2026. StackAI is now a subsidiary of Asana rather than an independent company',
        detail:
          'Founders Antoni Rosinol and Bernardo Aceituno joined Asana as part of the acquisition. Prior to the acquisition, StackAI had raised just under $20M total: a ~$3M seed round in 2023 led by Gradient Ventures (with Y Combinator, Soma Capital, and others participating), and a $16M Series A in May 2025 led by Lobby Capital and LifeX Ventures, with Gradient Ventures and Epakon Capital returning.',
        shortValue: 'Now a subsidiary of Asana (acquired 2026)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://techcrunch.com/2026/05/28/asana-acquires-no-code-agent-builder-stack-ai/',
            label: 'Asana acquires StackAI - TechCrunch',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/blog/stack-ai-raises-16m-series-a-to-create-ai-agents-for-every-job',
            label: 'StackAI Raises $16M Series A - StackAI blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.ycombinator.com/companies/stackai',
            label: 'StackAI - Y Combinator company page',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: StackAI runs a structured StackAI Academy with step-by-step lessons and courses covering platform overview, building workflows, knowledge bases, and agent building, plus a separate enterprise offering for AI-driven skills testing and certification.',
        detail:
          'Academy is lesson-based across multiple courses. Certification is a separate enterprise offering (skills testing and certification), not confirmed to be bundled into the core Academy itself.',
        shortValue: 'Yes, has StackAI Academy courses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/getting-started/learning/stackai-academy',
            label: 'StackAI Academy docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/academy',
            label: 'StackAI Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.stackai.com/solutions/skills-testing-and-certification',
            label: 'Skills Testing and Certification',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
