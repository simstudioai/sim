import { VellumIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const vellumProfile: CompetitorProfile = {
  id: 'vellum',
  name: 'Vellum',
  website: 'https://www.vellum.ai',
  isWorkflowBuilder: false,
  brand: {
    icon: VellumIcon,
    selfFramed: true,
    colors: ['#5c54dd', '#aca4ec', '#442c6c'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Vellum is an enterprise AI development platform for building, evaluating, and deploying LLM prompts, workflows, and agents.',
  standoutFeatures: [
    {
      title: 'Self-hosted / VPC enterprise deployment',
      description:
        "Enterprise customers can run the platform inside their own AWS, Azure, or GCP VPC (or on-prem) via a Replicated-based install, keeping prompts and documents inside the customer's network perimeter.",
      shortDescription: 'Runs inside your own AWS/Azure/GCP VPC or on-prem.',
      source: {
        url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
        label: 'Self-Hosted Vellum: Vellum Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: "Natural-language agent building ('Vellum for Agents')",
      description:
        'Non-technical users can describe a goal in plain language and have Vellum generate a working agent, automatically handling model selection, prompting, and integration wiring.',
      shortDescription: 'Describe a goal in plain language and Vellum builds the agent.',
      source: {
        url: 'https://www.vellum.ai/blog/introducing-vellum-for-agents',
        label: 'Introducing Vellum for Agents',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'SOC 2 Type 2 and HIPAA compliance with BAA',
      description:
        'Vellum documents SOC 2 Type 2 attestation and HIPAA compliance, with enterprise customers able to sign a Business Associate Agreement for handling protected health information, corroborated by a third-party Drata case study.',
      shortDescription: 'SOC 2 Type 2 and HIPAA compliance with a signable BAA.',
      source: {
        url: 'https://drata.com/customers/vellum',
        label: 'Vellum Case Study: Drata',
        asOf: '2026-07-02',
      },
    },
    {
      title: '$20M Series A, followed by a consumer pivot',
      description:
        "Vellum raised a $20M Series A in July 2025 (on top of a 2023 YC seed) to grow its enterprise platform. Since then, the company has separately launched a rebranded 'Personal Intelligence' consumer assistant product, open-sourced under MIT license on GitHub.",
      shortDescription: '$20M Series A, then a separate consumer product launch.',
      source: {
        url: 'https://www.vellum.ai/blog/announcing-our-20m-series-a',
        label: 'Announcing our $20m Series A: Vellum',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Brand/product ambiguity as of mid-2026',
      description:
        "Vellum's homepage, pricing page, security docs, and several product pages now serve content for a new consumer 'Personal Intelligence' assistant (an open-source, MIT-licensed Mac app) rather than the original enterprise workflow, evaluations, and prompt-engineering platform. That makes current enterprise-specific details, like environment promotion, version-control depth, tracing, alerting, and integration counts, harder to verify from the public site alone.",
      shortDescription:
        'Public site now foregrounds a consumer product over the enterprise platform.',
      source: {
        url: 'https://www.vellum.ai/',
        label: 'Vellum: Your Personal Intelligence',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'BYOK not documented on pricing',
      description:
        "Vellum's pricing pages describe a prepaid-credit model where Vellum passes through LLM costs at cost, with no bring-your-own-API-key option mentioned as an alternative billing or configuration path.",
      shortDescription: 'No bring-your-own-key option mentioned on pricing pages.',
      source: { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
    },
    {
      title: 'No enterprise SLA published',
      description:
        'No uptime or response-time SLA commitments are published on the enterprise or pricing pages.',
      shortDescription: 'No public SLA commitments found.',
      source: {
        url: 'https://www.vellum.ai/enterprise',
        label: 'Vellum Enterprise',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Deprecated legacy workflow nodes',
      description:
        'As of the January 2026 changelog, Vellum deprecated Merge, Conditional, and Output Nodes from the workflow builder UI (replaced by Merge Strategy, Ports, and Workflow Outputs respectively). Existing workflows using them continue to run but new instances can no longer be created.',
      shortDescription:
        'Legacy Merge/Conditional/Output nodes retired in favor of newer equivalents.',
      source: {
        url: 'https://docs.vellum.ai/changelog/2026/2026-01',
        label: 'Vellum Changelog: January 2026',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          "Visual workflow builder plus a code-first SDK, and a natural-language 'Vellum for Agents' mode for non-technical users",
        detail:
          "Vellum offers a visual graph builder and a code-first SDK that stay in sync, with nodes for model calls, retrieval, tool/API steps, and control flow. A separate 'Vellum for Agents' surface lets non-engineers describe a goal in plain language to generate an agent.",
        shortValue: 'Visual builder, code SDK, or natural language',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/introducing-vellum-for-agents',
            label: 'Introducing Vellum for Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://skywork.ai/blog/vellum-ai-review-prompt-management-evaluations-orchestration/',
            label: 'Vellum AI Review: Prompt Management, Evaluations & Orchestration',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value: 'Yes: self-hosted / VPC install available for enterprise customers',
        detail:
          "A 'Self-Hosted Vellum' path and a VPC Install option (via a Replicated-based deployment) let enterprises run the platform in their own AWS/Azure/GCP VPC or on-prem.",
        shortValue: 'Self-hosted / VPC for enterprise',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'Self-Hosted Vellum: Vellum Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/announcing-vellum-vpc',
            label: 'Announcing Vellum VPC',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value: 'Vellum Cloud (SaaS), self-hosted, and VPC install on AWS/Azure/GCP or on-prem',
        shortValue: 'Cloud, self-hosted, or VPC install',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'Self-Hosted Vellum: Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'A templates page exists on vellum.ai, though its contents are not publicly detailed.',
        shortValue: 'Exists; contents undocumented',
        confidence: 'unknown',
        sources: [],
      },
      license: {
        value:
          "Proprietary/commercial for the core enterprise Vellum platform. A separate consumer 'Vellum Assistant' product is open-sourced under MIT license.",
        detail:
          'github.com/vellum-ai/vellum-assistant is MIT-licensed (confirmed live, 825+ stars). No evidence the enterprise workflow/evaluations platform itself is open source.',
        shortValue: 'Proprietary enterprise platform; MIT consumer app',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/vellum-ai/vellum-assistant',
            label: 'vellum-ai/vellum-assistant: GitHub',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          "Vellum has Development/Staging/Production environments, each with isolated API keys, Release histories, and environment variables/secrets. Promotion works via a 'Promote' button on a Release to move a tested version to another environment, or by deploying directly to multiple environments at once. Sandboxes (prompt/workflow definitions) are shared across environments. Deployments and releases are environment-scoped.",
        detail:
          'Promotion operates at the level of individual workflow/prompt releases rather than whole-workspace forking.',
        shortValue: 'Dev/Staging/Prod with one-click promotion',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/deployments/environments',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Vellum maintains per-environment Release history with instant one-click rollback (no code changes required) and supports semantic-versioned Release Tags or a rolling LATEST tag. Version comparison is mentioned, but a dedicated diff/side-by-side comparison view is not explicitly documented.',
        shortValue: 'Release history with one-click rollback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://skywork.ai/blog/vellum-ai-review-prompt-management-evaluations-orchestration/',
            label: 'Vellum AI Review: Prompt Management, Evaluations & Orchestration',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/deployments/deployment-lifecycle-management',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Vellum's collaboration model is asynchronous, not live multi-user editing. Prompt Sandbox lets team members see each other's history, tag entries, and share/invite others, but there is no documented live-cursor or simultaneous editing of the same workflow or prompt.",
        detail:
          'Vellum documentation describes shared visibility into sandbox history and sharing/invite mechanisms, explicitly framed around sequential iteration rather than simultaneous editing.',
        shortValue: 'Async collaboration, no live co-editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/prompts/collaboration',
            label: 'Collaborate on Prompts with Vellum Prompt Sandbox',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Vellum's document handling is scoped to Document Indexes for RAG (upload, indexing, search), not a general-purpose file storage system. No documentation of folder hierarchy, shareable links with password/SSO auth, or a trash/recovery feature was found.",
        detail:
          "Documents are described as 'Environment-scoped', uploaded for indexing with size limits (e.g. up to 32MB) and supported formats (PDF, DOCX, CSV, etc.), but folder hierarchy, link-sharing with auth, and deleted-item recovery are not documented.",
        shortValue: 'RAG document indexes only, not general file storage',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/documents/uploading-documents',
            label: 'Easy Guide to Uploading Documents on Vellum AI',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: no evidence of a native spreadsheet-like data table feature (with row/column limits and spreadsheet keyboard navigation) as a standalone platform primitive. Vellum's tabular-data handling is limited to processing uploaded CSV/XLS files and extracting or generating structured output within workflow nodes.",
        detail:
          'Vellum documents document upload support for CSV/XLS and structured JSON extraction, and blog content about converting PDFs to CSV, but not an editable in-platform spreadsheet/data-table object comparable to a native DB feature.',
        shortValue: 'No native spreadsheet-style data table feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/tutorials/document-data-extraction',
            label: 'Document Data Extraction - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/tutorial-how-to-convert-any-pdf-to-csv',
            label: 'Tutorial: How to Convert Any PDF to CSV - Vellum',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: no documentation was found describing an inline rich-text/WYSIWYG markdown editor for documents stored within the B2B Vellum workflow platform (docs.vellum.ai). Prompt/node inputs in Workflows appear to be plain text/code fields.',
        detail:
          'A rich-text/Markdown document editor is documented for the separate, distinct Vellum personal-assistant product (vellum.ai, a 2026 pivot product), not confirmed for the B2B workflow/agent development platform being compared to Sim.',
        shortValue: 'Unknown for the workflow platform',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: Vellum has a Subworkflow node that executes a deployed or inline workflow as a step inside a parent workflow, waiting for it to finish and passing/receiving data through defined inputs and outputs.',
        detail:
          'Both "Deployed Subworkflows" (calling a separately versioned, released workflow) and "Inline Subworkflows" (defined within the parent workflow for modularization/reuse) are documented; the Agent Node can also register subworkflows as callable tools.',
        shortValue: 'Dedicated Subworkflow node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/api-reference/nodes/subworkflow-deployment-node',
            label: 'Subworkflow Deployment Node - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'Agent Node - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Model-agnostic across 20-23+ providers (OpenAI, Anthropic, Google/Gemini, Cohere, Azure OpenAI, Bedrock, Fireworks, Perplexity, Cerebras, Groq, etc.) and hundreds of individual models, including recent additions like GPT-5 and Claude Opus 4.1.',
        shortValue: '20+ providers, hundreds of models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'Vellum Changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Vellum has a documented 'Agent Node' (formerly 'Tool Calling Node') as its dedicated agent/reasoning-and-tool-execution block type within Workflows, supporting raw code, subworkflows, MCP tools, and Composio SaaS actions side by side in one node.",
        shortValue: 'Agent Node handles reasoning + tool execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          "Yes: 'Vellum for Agents' lets users describe a goal in plain language to generate a working agent",
        detail:
          'Handles model selection, prompt engineering, and integration wiring automatically from a natural-language description; targeted at Ops/Finance/Sales/Marketing users.',
        shortValue: 'Describe a goal, get a working agent',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/introducing-vellum-for-agents',
            label: 'Introducing Vellum for Agents',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          "Vellum supports RAG via 'Document Indexes' and a dedicated 'Evaluating RAG Pipelines' documentation area.",
        shortValue: 'Document Indexes + RAG pipeline evaluation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/evaluation/evaluating-rag-pipelines',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          "Agent Nodes support adding a remote MCP server as a tool via a '+ Tool' button, with automatic tool discovery (since August 2025).",
        shortValue: 'Remote MCP servers with auto tool discovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'Vellum Changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          "Vellum's 'Evaluations' product uses Test Suites and Metrics (0-1 scores) for quantitative evaluation, supports bulk CSV test-case upload, online/production evaluations, custom reusable metrics, and RAG-pipeline evaluation.",
        shortValue: 'Test suites, scored metrics, production evals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://skywork.ai/blog/vellum-ai-review-prompt-management-evaluations-orchestration/',
            label: 'Vellum AI Review: Prompt Management, Evaluations & Orchestration',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/evaluation/quantitative-evaluation',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          "An 'External Input' node pauses Workflow execution until a human or external system supplies input, enabling human-in-the-loop approval patterns.",
        shortValue: 'External Input node for approvals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/vellum-ai/vellum-python-sdks/blob/main/src/vellum/workflows/README.md',
            label: 'GitHub',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value: 'Unknown',
        detail:
          'Pricing includes credits for image generation as a billable usage type, but specific image/video/audio blocks or supported providers are not publicly detailed.',
        shortValue: 'Image-gen credits exist; blocks undocumented',
        confidence: 'unknown',
        sources: [
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "No: no evidence found of a named, reusable prompt or knowledge-snippet feature invoked by reference across multiple agents. Vellum's reuse primitives are Subworkflows (reusable workflow logic blocks) and shared Prompt Sandboxes, not a discrete 'skill' object referenced by name across agents.",
        detail:
          "Reuse is achieved via Subflows/subworkflows and deployed prompts, which is a different mechanism than a discrete named prompt-snippet library referenced across agents. Note: the separate Vellum personal-assistant product (a distinct pivot product) does have a 'Skills' concept, but that is not documented as part of the B2B workflow platform being compared here.",
        shortValue: 'Only subworkflows, no named skill objects',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/common-architectures',
            label: 'Building Common LLM Architectures with Vellum Workflows',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/built-in-tool-calling-for-complex-agent-workflows',
            label: 'Built-In Tool Calling for Complex Agent Workflows',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Vellum Agents can be built with a first-class Chat Message Trigger that maintains chat_history/conversation state across turns, and Workflows/Agents can be deployed with this chat interaction pattern rather than only form/API/webhook targets.',
        detail:
          "Documented alongside RAG chatbot tutorials and the Agent Node's conversation-state handling; deployment surface details (e.g., a hosted public chat widget URL) were not independently confirmed beyond the trigger/state mechanism.",
        shortValue: 'Chat Message Trigger for deployed conversational agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/tutorials/building-a-rag-chatbot',
            label: 'Building a RAG Chatbot from Scratch - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/changelog/2026/2026-01',
            label: 'Vellum Changelog: January 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: Vellum's Document Index search returns individual chunk-level results, and Advanced Chunking exposes per-chunk metadata (like the source page range) alongside configurable chunk size and overlap settings, giving chunk-level visibility for debugging retrieval quality.",
        detail:
          'Documented under the Document Indexes / Search API and RAG pipeline evaluation docs; each search result object represents one matching chunk, not a whole document.',
        shortValue: 'Search returns per-chunk results with metadata',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/client-sdk/document-indexes/search',
            label: 'Search - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/evaluation/evaluating-rag-pipelines',
            label: 'Evaluating RAG Pipelines - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: Vellum Workflows has a Map Node that iterates over an array and executes a subworkflow concurrently for each item, and a Merge Strategy (available on all node types, replacing the older standalone Merge Node) that consolidates divergent execution paths back into one result.',
        detail:
          'As of the January 2026 release, the standalone Merge Node was replaced by Merge Strategy, a setting on every node type, so branches can fan out via the Map Node and fan back in without a dedicated join node.',
        shortValue: 'Map Node fans out, Merge Strategy fans back in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/api-reference/nodes/merge-node',
            label: 'Merge Node - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/changelog/2026/2026-01',
            label: 'Vellum Changelog: January 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: Vellum documentation and changelogs show no support for the Agent2Agent (A2A) protocol. Vellum has written about the related Google AP2 payments protocol, but has not documented an A2A implementation or Agent Card support.',
        detail:
          'No mentions of "Agent2Agent" or "A2A" appear in Vellum product docs, help center, or changelog as of this review; this reflects the absence of public documentation, not a confirmed statement from Vellum that it will never support it.',
        shortValue: 'Not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/',
            label: 'Vellum Documentation (no A2A/Agent2Agent results)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/googles-ap2-a-new-protocol-for-ai-agent-payments',
            label: "Google's AP2: A new protocol for AI agent payments - Vellum Blog",
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          "No: Vellum's only documented list-iteration mechanism is the Map Node, which executes a subworkflow once per array item concurrently (up to 96 parallel executions) rather than as a dedicated sequential for-each/while container; no separate While/loop node is documented.",
        detail:
          'The Map Node is already the mechanism counted under parallelExecution (concurrent fan-out plus Merge Strategy join). Vellum documentation does not describe a way to force single-lane sequential iteration or a distinct while/repeat-until construct.',
        shortValue: 'Only a concurrent Map Node, no sequential loop',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/map-node',
            label: 'Map Node - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          "Via a Composio partnership (August 2025), Vellum connects to Composio's library of 10,000+ tools directly inside Agent Nodes (Google Sheets, Slack, Salesforce, Notion, Jira, Linear, Trello, etc.). Vellum separately advertises 100+ of its own native integrations.",
        shortValue: '10,000+ tools via Composio, 100+ native',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/introducing-vellum-for-agents',
            label: 'Introducing Vellum for Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/vellum-composio-new-partnership-for-ai-agent-building',
            label: 'Vellum Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value: 'Unknown',
        detail:
          "A 'Chat Message Trigger' exists for chat-first agent building; the full set of trigger types (webhook, API, etc.) is not publicly enumerated.",
        shortValue: 'Chat trigger confirmed; full list undocumented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2026/2026-01',
            label: 'Vellum Changelog: January 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          "Vellum has a documented 'Code Execution Node' supporting custom Python or TypeScript code with a required main() function signature, an in-browser IDE, and support for public PyPI/npm packages. Newer 'Custom Nodes' are expected to eventually replace it.",
        shortValue: 'Python/TypeScript code node with in-browser IDE',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/code-execution-node',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Deploying a Workflow from the Vellum UI produces a code snippet to call it in production as an API. Vellum handles execution server-side and callers just supply input variables; each execution is also viewable/shareable via an execution URL.',
        shortValue: 'One-click deploy to a callable API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/api-integration',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          "The Workflows SDK (GitHub: vellum-ai/vellum-python-sdks) is an open-source Python framework for defining and executing agentic workflows as graphs declaratively; docs also describe a 'Custom Nodes' extensibility tutorial.",
        detail: 'Language support beyond Python is not publicly confirmed.',
        shortValue: 'Open-source Python Workflows SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/introducing-vellum-for-agents',
            label: 'Introducing Vellum for Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Vellum's documented MCP support runs in one direction only. Its Agent Node lets a workflow connect to and call external/remote MCP servers as tools (with auto-discovered schemas). No documentation describes the reverse: publishing a deployed Vellum workflow itself as a callable MCP server for external AI tools to consume.",
        detail:
          "August 2025 changelog and blog content describe adding MCP servers as tools inside Agent nodes; a specific 'How does MCP work' Vellum blog post does not address exposing Vellum workflows as MCP endpoints. Some third-party sources conflate this with Vellum's separate personal-assistant product exposing its own MCP server, which is a different, non-workflow-platform product.",
        shortValue: 'MCP client only, not MCP server publishing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'August 2025 Changelog - Vellum Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/blog/how-does-mcp-work',
            label: 'How does MCP work - Vellum Blog',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Prepaid/pay-as-you-go credits ($1 credit = $1 of underlying LLM/API cost, no markup) plus a tiered monthly subscription for compute/storage',
        detail:
          "Current pricing pages describe the consumer 'Personal Intelligence' product's plans (Base/Free and Pro $50/mo tiers with configurable vCPU/RAM/storage add-ons) rather than the original enterprise workflow platform's seat/usage-based pricing.",
        shortValue: 'Pass-through LLM credits + subscription',
        confidence: 'verified',
        sources: [
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
          {
            url: 'https://www.vellum.ai/docs/pricing',
            label: 'Vellum Docs: Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Around $50/month for a typical Pro-tier setup, plus usage credits',
        detail:
          "The Pro plan has a $10/month platform fee (includes custom subdomain and priority support). Actual monthly cost depends on the compute tier chosen ($35-$125/mo) and storage tier chosen ($5-$120/mo); Vellum's own example configuration totals $50/month before usage credits.",
        shortValue: '~$50/mo example configuration plus usage credits',
        confidence: 'verified',
        sources: [
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
        ],
      },
      freeTier: {
        value:
          "Yes: free 'Base' plan with small fixed compute and 4 GiB storage, no credit card required",
        shortValue: 'Free Base plan, no card required',
        confidence: 'verified',
        sources: [
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value: 'Not mentioned on current pricing pages',
        detail:
          'Pricing is structured around Vellum-provided credits passed through at cost, with no bring-your-own-API-key option described as an alternative.',
        shortValue: 'No BYOK option documented',
        confidence: 'unknown',
        sources: [
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type 2',
        detail:
          'Documented at docs.vellum.ai and corroborated by a third-party Drata customer case study noting Vellum achieved SOC 2 Type 1 and Type 2 attestations.',
        shortValue: 'SOC 2 Type 2 attested',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage',
            label: 'Vellum Docs: Data Privacy and Storage',
            asOf: '2026-07-02',
          },
          {
            url: 'https://drata.com/customers/vellum',
            label: 'Vellum Case Study: Drata',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value: 'Unknown: no specific region/residency options documented',
        detail:
          "Docs describe data being stored 'in Vellum's infrastructure, isolated in a dedicated, encrypted container' but do not specify selectable data-residency regions.",
        shortValue: 'No selectable residency regions documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage',
            label: 'Vellum Docs: Data Privacy and Storage',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value: 'Yes: workspace-level role-based access control with six predefined roles',
        detail:
          "Roles are Admin, Deployment Editor, Document Index Editor, Test Suite Editor, Playground Editor, and Member (read-only). Permissions apply workspace-wide rather than per individual resource, and only Admins can change other users' roles.",
        shortValue: 'Six workspace-level roles, Admin to read-only Member',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/rbac-permissions',
            label: 'Role-Based Access Control (RBAC) - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value: 'Unknown',
        detail:
          'Not publicly documented for the enterprise platform; permissions-model docs describe per-action risk badges for the consumer assistant product only.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.vellum.ai/docs/trust-security/the-permissions-model',
            label: 'Vellum Docs: The Permissions Model',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'HIPAA compliant (BAA available for enterprise customers); ISO 27001, GDPR-specific attestation, PCI, and FedRAMP not confirmed',
        detail:
          'Docs and a third-party Drata case study both state Vellum is HIPAA compliant and that enterprise customers can sign a Business Associate Agreement (BAA). No mention of ISO 27001, PCI, or FedRAMP certification was found.',
        shortValue: 'HIPAA + BAA; no other certs confirmed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage',
            label: 'Vellum Docs: Data Privacy and Storage',
            asOf: '2026-07-02',
          },
          {
            url: 'https://drata.com/customers/vellum',
            label: 'Vellum Case Study: Drata',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'No: Vellum documents workspace-level Role-Based Access Control (Admin/Member style roles governing create/update/delete permissions) but no documentation was found for restricting which specific stored credentials/connections a role or permission group may use.',
        detail:
          'RBAC docs describe workspace-wide role permissions (Admin vs Member) rather than credential-level allow/deny lists. A separate, unrelated Vellum personal-assistant product does describe per-credential allowedTools/allowedDomains scoping, but that is a different product from the B2B workflow platform being compared.',
        shortValue: 'Workspace RBAC only, no per-credential scoping',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/rbac-permissions',
            label: 'Role-Based Access Control (RBAC)',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          "Unknown: no documentation was found describing replacing Vellum's own branding (logo, product name, theme) with a customer's branding across the workspace or deployed apps. Only generic 'white glove' Enterprise service language was found, and that refers to onboarding support, not white-label branding.",
        detail:
          "Vellum's own branding-guide page addresses Vellum's use of its own brand assets by others, not a customer-facing white-label capability.",
        shortValue: 'Unknown, no white-label branding docs found',
        confidence: 'unknown',
        sources: [],
      },
      dataRetention: {
        value:
          'Yes: Enterprise customers can configure data retention policies to automatically delete monitoring/interaction data after a specified period (30, 60, 90, or 365 days) instead of the default indefinite retention.',
        detail:
          'Configured from Organization Settings under Advanced Settings; default behavior without this Enterprise configuration is indefinite retention.',
        shortValue: 'Enterprise-configurable 30 to 365 day retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage',
            label: 'Data Privacy and Storage - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Unknown: no documentation was found confirming or denying a dedicated PII detection/redaction feature distinct from generic Guardrail nodes for output validation.',
        detail:
          'Vellum documents a general Guardrail Node for workflow quality checks, but no page specifically describing PII detection/redaction (emails, SSNs, etc.) in workflow content or logs was found.',
        shortValue: 'Unknown',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Unknown: third-party summaries claim Vellum supports SSO/SAML, but no first-party Vellum documentation describing SAML/OIDC setup or auto-provisioning on first login could be located.',
        detail:
          "Vellum's own security/data-privacy documentation page does not mention SSO/SAML, and a direct search of docs.vellum.ai for SSO/SAML configuration returned no dedicated setup page.",
        shortValue: 'Claimed by third parties, undocumented directly',
        confidence: 'unknown',
        sources: [],
      },
      thirdPartyVetting: {
        value:
          "Yes: Vellum's tool ecosystem is closed and vendor/partner controlled, not an open marketplace. Its own 100+ native integrations are built and maintained by Vellum, its Composio partnership adds access to Composio's curated tool library (not third-party developer submissions reviewed loosely), and 'Custom Nodes' are authored by the customer's own team for internal reuse rather than published to a shared public marketplace for other tenants to install.",
        detail:
          "No documentation was found describing a public marketplace or community-node/plugin registry where independent third-party developers publish executable code that other Vellum customers can browse and install, unlike ecosystems such as n8n community nodes. Custom Nodes extend a single customer's own workflows and are not distributed to other organizations. No publicly documented security incidents involving Vellum's integration or tool ecosystem were found.",
        shortValue: 'Closed first-party/partner catalog, no open plugin marketplace',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/vellum-composio-new-partnership-for-ai-agent-building',
            label: 'Vellum + Composio: Build Powerful AI Agents Faster',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/tutorials/custom-nodes',
            label: 'Custom Nodes - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Vellum automatically captures every Prompt/Workflow execution in production into filterable, sortable Executions tables, including per-step inputs, outputs, latency, and aggregated cost, plus shareable execution URLs for linking from external tools and alerts.',
        shortValue: 'Full execution tracing with shareable URLs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://skywork.ai/blog/vellum-ai-review/',
            label: 'Vellum Review: Reliable AI Workflow Orchestration & Observability',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/deployments/observability',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          "Vellum supports 'Retry Node Adornments' (organized under an 'Error Handling' section of node Settings) that automatically re-invoke a failed node up to a configured max-attempts count.",
        shortValue: 'Automatic node-level retries',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/node-types',
            label: 'Vellum Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Yes: Vellum supports streaming execution/monitoring events (workflow execution initiated/fulfilled/rejected, usage calculation, metric execution events) continuously to external systems via configurable webhooks, including documented support for forwarding to Datadog.',
        detail:
          'Configured from Organization Settings; supports API key, Bearer token, and HMAC verification for webhook payloads. No explicit native S3 or BigQuery connector was found, but the generic webhook mechanism supports building such an export.',
        shortValue: 'Webhooks stream events to Datadog and custom systems',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/monitoring/webhooks',
            label: 'Webhook Integration - Vellum Documentation',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: Vellum offers an Execute Workflow Async API endpoint that starts a workflow run and returns an execution_id immediately, without blocking. A separate status endpoint lets clients poll for the current state (PENDING, FULFILLED, REJECTED, etc.) and outputs once the run finishes.',
        detail:
          'Introduced November 2025. Vellum also documents an Execute Workflow as Stream endpoint for streaming responses, in addition to the synchronous Execute Workflow call that blocks until completion.',
        shortValue: 'Yes, via async execution_id + status polling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-11',
            label: 'Vellum Changelog, November 2025 (async workflow execution)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/developers/client-sdk/workflows/execute-workflow',
            label: 'Vellum Docs: Execute Workflow (synchronous SDK call)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/api-reference/workflows/execute-workflow-stream',
            label: 'Vellum API Reference: Execute Workflow as Stream',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Unknown: Vellum confirms a per-account concurrency limit exists, and that async executions automatically queue once it is exceeded, but does not publish the actual numbers. No max concurrent executions, max execution duration, or requests-per-minute rate limit is listed on its public docs or pricing pages.',
        detail:
          "The November 2025 changelog states executions 'automatically queue when you exceed your concurrency limit' but gives no figure. The public pricing page describes credit-based billing and machine sizes (vCPU/RAM tiers) but no execution timeout or concurrency figures. Third-party blog posts cite older per-day execution caps, but these aren't confirmed on Vellum's own current docs, so they aren't included as a verified figure.",
        shortValue: 'Concurrency limit exists, no public numbers',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value:
          "Yes: Vellum lets you wrap any workflow node with a Try or Retry node adornment for first-class error handling, so a single node's failure does not have to halt the entire run. The Try adornment attempts the node once and continues the workflow with an Error output if it fails, while the Retry adornment repeatedly re-invokes the node until it succeeds or a maximum attempt count is reached.",
        detail:
          "Adornments are applied from the node's side panel and appear in monitoring as a single-node subworkflow, so downstream branches can consume the Error output and keep the rest of the run going instead of the whole execution stopping.",
        shortValue: 'Yes, via Try/Retry node adornments',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-03',
            label: 'Vellum Changelog, March 2025 (Try/Retry node adornments)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/overview',
            label: 'Vellum Docs: Nodes Overview (adornments, error handling)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Discord community; priority support included on paid plans',
        detail:
          'The pricing and enterprise pages reference a Discord community channel and note that the Pro plan includes priority support.',
        shortValue: 'Discord community + priority support',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.vellum.ai/enterprise',
            label: 'Vellum Enterprise',
            asOf: '2026-07-02',
          },
          { url: 'https://www.vellum.ai/pricing', label: 'Vellum Pricing', asOf: '2026-07-02' },
        ],
      },
      sla: {
        value: 'Unknown: no SLA commitments or figures found on current public pages',
        detail:
          "The enterprise and pricing pages now serve the consumer 'Personal Intelligence' product and contain no SLA language (uptime, response time, or otherwise). An earlier version of this page may have referenced named SLA features, but that could not be confirmed on the live site, so it is not included as a verified claim.",
        shortValue: 'No SLA content found on current site',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value: 'Discord community exists',
        shortValue: 'Discord community',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.vellum.ai/enterprise',
            label: 'Vellum Enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2023 (Y Combinator W23) by Noa Flaherty, Sidd Seethepalli, and Akash Sharma. Raised a $5M seed (2023) and a $20M Series A (July 2025, led by Leaders Fund), for about $25.5M total. Based in New York City, with 150+ reported customers as of the Series A announcement.',
        shortValue: 'YC W23, ~$25.5M raised, NYC-based',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/announcing-our-20m-series-a',
            label: 'Announcing our $20m Series A: Vellum',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.crunchbase.com/organization/vellum-74f3',
            label: 'Vellum: Crunchbase Company Profile & Funding',
            asOf: '2026-07-02',
          },
          {
            url: 'https://voicebot.ai/2023/07/13/generative-ai-prompt-engineering-startup-vellum-ai-raises-5m/',
            label: 'Generative AI Prompt Engineering Startup Vellum.ai Raises $5M: Voicebot.ai',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'No: Vellum has not documented a structured Academy-style learning resource with courses or certification. It offers standard documentation (docs.vellum.ai), a blog, and webinars, but no dedicated course/certification program was found.',
        detail:
          "Searches for 'Vellum academy', 'certification', 'courses' turned up only docs, blog posts, and webinars; no evidence of a structured curriculum.",
        shortValue: 'No structured academy or certification',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/home/getting-started/support',
            label: "Vellum's Help Center",
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.vellum.ai/webinars',
            label: 'Vellum Webinars',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
