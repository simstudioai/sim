import { TinesIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public primary sources on 2026-09-04; unverified capabilities are labeled. */
export const tinesProfile: CompetitorProfile = {
  id: 'tines',
  name: 'Tines',
  website: 'https://www.tines.com',
  brand: {
    icon: TinesIcon,
    selfFramed: true,
    colors: ['#8c74e3', '#c4b4dd', '#f2eef7'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Tines offers Stories, a visual workflow platform with AI agents and Workbench, and Tines 3B, a newer code-based platform for AI apps, agents, and automation. Capabilities and pricing below identify which product they cover.',
  standoutFeatures: [
    {
      title: 'Stories and 3B development choices',
      description:
        'Stories retains its visual workflow builder, while 3B adds a code-based platform for apps, agents, and automation. Tines says it continues investing in both.',
      shortDescription: 'Visual Stories and code-based 3B address different building needs.',
      source: {
        url: 'https://www.tines.com/blog/whats-new-in-tines-july-2026-edition/',
        label: 'Tines product updates for July 2026',
        asOf: '2026-09-04',
      },
    },
    {
      title: '3B branches and Git',
      description:
        'Tines 3B lets builders edit workflow source in a Git repository and push changes from external coding tools.',
      shortDescription: '3B workflows can be edited through Git.',
      source: {
        url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
        label: 'Build a workflow in your own coding tools | Tines 3B Docs',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'ISO security, privacy, and AI governance',
      description:
        'Tines publicly reports ISO 27001, ISO 27701, and ISO 42001 certification for its management programs.',
      shortDescription: 'Published ISO security, privacy, and AI governance certifications.',
      source: {
        url: 'https://www.tines.com/blog/tines-achieves-the-iso-trifecta-iso-27001-iso-27701-and-iso-42001-certification/',
        label: 'Tines sets the AI governance standard with ISO 42001, 27001, and 27701',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Structured training and certification',
      description:
        'Tines offers Core and Advanced Stories certification programs with hands-on learning.',
      shortDescription: 'Core and Advanced Stories certification programs.',
      source: {
        url: 'https://www.tines.com/get-certified/',
        label: 'Get certified | Tines',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Paid pricing requires a quote',
      description: 'The public 3B pricing page lists paid editions without a general dollar price.',
      shortDescription: '3B paid editions require a quote.',
      source: {
        url: 'https://www.tines.com/pricing/',
        label: 'Pricing | Tines',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Two distinct products',
      description:
        'Stories and 3B have different builders and documentation. Evaluate requirements against the product being purchased.',
      shortDescription: 'Capabilities should be checked for the selected Tines product.',
      source: {
        url: 'https://www.tines.com/blog/whats-new-in-tines-july-2026-edition/',
        label: 'Tines product updates for July 2026',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Stories synchronous response deadline',
      description:
        'Stories MCP responses must complete within 30 seconds. The underlying tool may continue after timeout without returning the result to the MCP caller.',
      shortDescription: 'Stories MCP responses have a 30-second deadline.',
      source: {
        url: 'https://www.tines.com/stories/docs/actions/templates/mcp-server/',
        label: 'MCP server',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Stories draft execution is temporary',
      description:
        'Change Control drafts stop processing after 30 minutes of inactivity and are not intended for autonomous production execution.',
      shortDescription: 'Stories drafts do not run indefinitely when unattended.',
      source: {
        url: 'https://www.tines.com/stories/docs/stories/change-control/',
        label: 'Change Control',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Tines Stories combines a visual event-driven canvas with Workbench assistance. Tines 3B builds code-based workflows through prompts or external coding tools.',
        shortValue: 'Stories visual canvas; 3B prompts and code',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/',
            label: 'Tines Stories | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/whats-new/workbench-for-stories/',
            label: "Story copilot is now Workbench | What's new at Tines",
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Stories supports visual configuration and templates; advanced API work and 3B code workflows still require technical understanding.',
        shortValue: 'Visual starts; advanced workflows require technical knowledge',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/templates/',
            label: 'Public Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: Stories Business and Enterprise support self-hosting in addition to Tines-hosted cloud.',
        shortValue: 'Yes, commercial self-hosting options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Deployment and entitlement should be confirmed for the chosen Tines product and plan.',
      },
      deploymentOptions: {
        value:
          'Tines-hosted cloud and customer-hosted deployments; Stories Business and Enterprise offer self-hosting.',
        shortValue: 'Vendor cloud or customer-hosted deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value:
          'Stories has a public library of workflows and action templates; 3B provides an examples gallery.',
        shortValue: 'Stories library and templates; 3B examples',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/library/',
            label: 'Home | Stories | Library',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/templates/',
            label: 'Public Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'Commercial subscription software, with limited rights to use the platform under Tines terms. Free editions are product plans.',
        shortValue: 'Commercial license; free product editions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/general-terms-aug-2024/',
            label: 'Tines General Terms',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Stories Change Control supports testable drafts, reviews, and pushing changes live. 3B has isolated draft branches and three-way merges into production.',
        shortValue: 'Stories reviewed drafts; 3B branches and merges',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/change-control/',
            label: 'Change Control',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/15877997-branches',
            label: 'Tines 3B branches',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These are product-specific workflow development models; a universal multi-workspace dev/QA/prod promotion system was not verified.',
      },
      versionControlDepth: {
        value:
          'Stories offers saved versions, visual change previews, export, cloning, and restore. 3B adds Git-based source and draft-branch merges.',
        shortValue: 'Version history and restore; 3B Git branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/story-versioning/',
            label: 'Story versions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/15877997-branches',
            label: 'Tines 3B branches',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          '3B supports collaboration on the same draft branch with real-time presence indicators. Synchronized shared cursors and selections were not verified.',
        shortValue: '3B shared draft presence; cursor synchronization unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.3b.tines.com/en/articles/15877997-branches',
            label: 'Tines 3B branches',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          '3B provides persistent shared volumes and a file browser with folder navigation, previews, and downloads. Authenticated share links and deleted-file recovery were not verified.',
        shortValue: '3B persistent volumes and file browser',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.3b.tines.com/en/articles/16082401-storage',
            label: 'Tines 3B storage',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Live storage is shared within a space; drafts use isolated storage that is discarded rather than promoted.',
      },
      dataTables: {
        value:
          'Stories Records stores typed fields and provides filterable tables, charts, and exports. Full spreadsheet-style keyboard editing was not verified.',
        shortValue: 'Stories Records tables and charts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/records/',
            label: 'Records',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value:
          'Stories Pages supports Markdown rich-text elements and Markdown in table cells. A full stored-document WYSIWYG editor was not verified.',
        shortValue: 'Markdown rich text in Stories Pages',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/rich-text-in-pages-with-markdown/',
            label: "Rich text in pages with Markdown | What's new at Tines",
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/whats-new/markdown-support-in-page-table-cells/',
            label: "Markdown support in page table cells | What's new at Tines",
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: Stories Send to Story calls reusable published sub-stories and returns their output to the calling action.',
        shortValue: 'Yes, published sub-stories return outputs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/send-to-story/',
            label: 'Send to Story',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value:
          'Stories supports reusable private action templates and shared sub-stories with defined inputs; a distinct published toolbar block for every workflow was not verified.',
        shortValue: 'Private templates and shared sub-stories',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/private-templates/',
            label: 'Private Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/stories/send-to-story/',
            label: 'Send to Story',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Sub-story callers can be allowed to run a story without permission to view or edit its internals. Private templates are available through toolbar search.',
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: Stories supports multiple enabled providers and compatible custom endpoints. 3B documents OpenAI, Anthropic, Azure OpenAI, and OCI provider connections.',
        shortValue: 'Multiple providers, with product-specific support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/ai/',
            label: 'AI',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050726-connect-your-ai-provider',
            label: 'Tines 3B AI providers',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Stories AI Agent actions perform tool-using reasoning in task or chat mode; 3B also provides agent workflow templates.',
        shortValue: 'Yes, tool-using agents in Stories and 3B',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Workbench for Storyboard builds and edits Stories; 3B builds apps and workflows from natural-language prompts.',
        shortValue: 'Yes, Workbench and 3B prompt-based building',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/workbench-for-stories/',
            label: "Story copilot is now Workbench | What's new at Tines",
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/3b/',
            label: 'Tines 3B | The AI-native intelligent workflow platform',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'External knowledge can be retrieved through configured tools and MCP. A native indexed knowledge-base product with documented chunking was not verified.',
        shortValue: 'Tool-based retrieval; native indexed KB unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/workbench/',
            label: 'Workbench',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Stories AI Agent and Workbench can call remote MCP tools, with configurable tool access.',
        shortValue: 'Yes, remote MCP tools in Stories',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/workbench/',
            label: 'Workbench',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Stories AI Agent supports output-schema validation and configurable tools; Workbench can require confirmation for tools. 3B proposes tests while building.',
        shortValue: 'Output validation, confirmations, and 3B build tests',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/workbench/',
            label: 'Workbench',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/3b/',
            label: 'Tines 3B | The AI-native intelligent workflow platform',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A dedicated scored LLM evaluation suite was not verified. These controls do not guarantee factual correctness or prevent every prompt injection.',
      },
      humanInTheLoop: {
        value:
          'Stories Pages collects human input mid-run for requester/approver flows; Workbench can require confirmation before running a story.',
        shortValue: 'Stories Pages approvals and Workbench confirmations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/pages/',
            label: 'Pages',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/workbench/',
            label: 'Workbench',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed sources establish these interaction patterns, not a universal checkpoint/resume guarantee across every action.',
      },
      generativeMedia: {
        value:
          'Unknown: dedicated native image, video, or speech generation actions were not verified. Provider APIs can be integrated through HTTP actions or 3B code.',
        shortValue: 'Dedicated media-generation actions unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/http-request/',
            label: 'HTTP Request',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Stories agents choose among configured template, sub-story, custom, built-in, and remote MCP tools. Broader unconfigured tool discovery was not verified.',
        shortValue: 'Agent chooses from configured tool sources',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: automatic failover to a different model or provider was not verified. Provider selection and retry settings are documented.',
        shortValue: 'Automatic cross-model failover unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/admin/ai/',
            label: 'AI',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value:
          'Yes: Stories Workbench imports SKILL.md instructions and loads them on demand; 3B also supports named Markdown skills.',
        shortValue: 'Yes, reusable skills loaded on demand',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/workbench-skills/',
            label: "Workbench skills | What's new at Tines",
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16024521-skills',
            label: 'Tines 3B skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Stories AI Agent chat mode can be opened to anyone with its link, with administrator configuration.',
        shortValue: 'Yes, public-link Stories agent chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/public-ai-agent-action-chats/',
            label: '"Anyone with the link" access for AI agent chat | What\'s new at Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Unknown: native indexed knowledge-base chunk inspection was not verified.',
        shortValue: 'Native KB chunk inspection unverified',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'Yes: Stories Explode/Implode splits and recombines events; 3B links can fan out to downstream steps in parallel.',
        shortValue: 'Yes, Stories split/join and 3B parallel steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/7228858-using-explode-and-implode',
            label: 'Using explode and implode',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Stories does not guarantee that exploded events rejoin in their original order.',
      },
      a2aProtocol: {
        value: 'Unknown: native Agent2Agent protocol support was not verified.',
        shortValue: 'A2A support unverified',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value:
          'Yes: Stories Send to Story supports sequential per-item loops and aggregated outputs; message-only transforms also support looping.',
        shortValue: 'Yes, action loops with aggregated results',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/send-to-story/',
            label: 'Send to Story',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/event-transformation/message-only/',
            label: 'Tines Stories message-only loops',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The documented loop size is fewer than 20,000 elements. Message-only loops have a five-minute processing timeout.',
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Stories uses public/private action templates and generic HTTP requests; 3B connects through APIs and MCP. These are not a comparable fixed app count.',
        shortValue: 'Action templates, APIs, and MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/templates/',
            label: 'Public Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/http-request/',
            label: 'HTTP Request',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/3b/',
            label: 'Tines 3B | The AI-native intelligent workflow platform',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Stories supports webhooks, scheduled actions, incoming email, and sub-story calls; 3B main branches support schedules, webhooks, and public routes.',
        shortValue: 'Webhooks, schedules, email, and sub-workflow calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/receive-email/',
            label: 'Receive Email ',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/send-to-story/',
            label: 'Send to Story',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/whats-new/schedule-with-cron-expressions/',
            label: "Schedule with cron expressions | What's new at Tines",
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/15877997-branches',
            label: 'Tines 3B branches',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Stories Run Script runs Python; 3B steps support shell, Python, TypeScript on Bun, React interfaces, and agent templates.',
        shortValue: 'Stories Python; 3B shell, Python, and TypeScript',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/tools/run-script/',
            label: 'Run script',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Stories supports PyPI dependencies and custom Python runtimes with system libraries. 3B steps include Dockerfiles and language-specific dependency files.',
        shortValue: 'Custom runtimes and dependencies; 3B Dockerfiles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/tools/run-script/',
            label: 'Run script',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/tools/run-script/custom-runtimes/',
            label: 'Custom runtimes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: Stories exposes workflows through response-enabled webhooks; 3B can publish API routes with an OpenAPI description.',
        shortValue: 'Yes, Stories webhooks and 3B API routes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/apis/',
            label: 'Workflows as APIs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Stories provides a REST API and action templates; 3B offers Git access, a CLI, REST endpoints, and code templates.',
        shortValue: 'REST and templates; 3B Git and CLI',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/api/welcome/',
            label: 'Tines Stories: Welcome',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/private-templates/',
            label: 'Private Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A general-purpose third-party installable node SDK was not verified.',
      },
      mcpPublishing: {
        value:
          'Yes: Stories can expose template, sub-story, and custom tools through remote MCP servers built on the storyboard.',
        shortValue: 'Yes, Stories can publish remote MCP tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/mcp-server/',
            label: 'MCP server',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Tool responses are subject to the documented response-enabled webhook time and concurrency limits.',
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Stories uses Community, Business, and Enterprise packages with capacity and AI-credit add-ons. 3B uses a platform license with Explore and paid editions.',
        shortValue: 'Product-specific platform plans and usage allowances',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/3b/',
            label: 'Tines 3B | The AI-native intelligent workflow platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Stories Business and 3B paid editions require a quote; the public pricing pages do not give a general paid entry price.',
        shortValue: 'Paid editions require a quote',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'Stories Community: 1 user, 3 flows, 25,000 monthly events, and 50 monthly AI credits. 3B Explore: unlimited users/spaces/connectors, 3 live workflows, and a one-time $50 AI allowance.',
        shortValue: 'Separate Stories Community and 3B Explore allowances',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: Stories accepts custom AI providers and credentials; 3B supports customer-connected AI providers on its paid offering.',
        shortValue: 'Yes, product-specific AI provider connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/ai/',
            label: 'AI',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050726-connect-your-ai-provider',
            label: 'Tines 3B AI providers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Provider charges and platform entitlements remain separate; the reviewed sources do not establish that bringing a key removes all platform charges.',
      },
    },
    security: {
      dataResidency: {
        value:
          'Cloud and customer-hosted deployments are available. Model-provider, tool, and web-search configuration affects where data is processed.',
        shortValue: 'Hosting and external providers determine processing locations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Stories web-search requests from EU stacks are processed in the EU; other stacks use the US. External tool and custom-provider calls require their own residency assessment.',
      },
      rbac: {
        value:
          'Stories has team-based separation and roles; custom roles are a plan-dependent Enterprise Tenant Management feature. 3B also includes RBAC.',
        shortValue: 'Team roles; plan-dependent custom roles; 3B RBAC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/user-administration/custom-roles/',
            label: 'Custom roles',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/3b/',
            label: 'Tines 3B | The AI-native intelligent workflow platform',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: Stories records tenant changes and offers enhanced AI audit entries; 3B logs user activity and supports external destinations.',
        shortValue: 'Yes, activity and optional detailed AI audit logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/audit-logs/',
            label: 'Audit logs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16051171-monitor-tenant-activity-in-the-audit-logs',
            label: 'Tines 3B audit logs',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Stories enhanced AI logs include model and tool inputs/outputs when enabled, so retention and access configuration matter.',
      },
      compliance: {
        value:
          'Tines reports SOC 2 Type II, ISO 27001, ISO 27701, ISO 42001, and TX-RAMP Level 2 for Stories and 3B.',
        shortValue: 'SOC 2, ISO certifications, and TX-RAMP Level 2',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/blog/tines-achieves-the-iso-trifecta-iso-27001-iso-27701-and-iso-42001-certification/',
            label: 'Tines sets the AI governance standard with ISO 42001, 27001, and 27701',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/blog/tines-achieves-tx-ramp-level-2-certification/',
            label: 'Tines TX-RAMP Level 2 announcement',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The September 3 TX-RAMP announcement explicitly covers both products and says FedRAMP authorization is being pursued. Public claims were checked; underlying report and certificate scopes were not independently audited.',
      },
      modelAndToolGovernance: {
        value:
          'Stories tenant owners can control AI features, enabled models, and provider access by team; tool access is configured on agents and Workbench presets.',
        shortValue: 'Yes, provider/team controls and configured tool access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/ai/',
            label: 'AI',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/workbench/',
            label: 'Workbench',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Stories credentials are team-scoped by default, can be shared with selected teams, and support domain restrictions.',
        shortValue: 'Yes, team sharing and credential domain restrictions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/credentials/credential-configuration/access/',
            label: 'Access',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/tines-security-best-practices/',
            label: 'Tines security best practices | Tines',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Credential settings require the relevant management permissions. Running a shared resource need not grant visibility into its secret contents.',
      },
      whiteLabeling: {
        value:
          'Stories Pages supports customer logos, colors, themes, and page layouts. Complete tenant-wide replacement of vendor branding was not verified.',
        shortValue: 'Stories page branding; tenant-wide replacement unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/pages/branding-and-style/',
            label: 'Branding and style',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Stories audit retention defaults to two years and can be reduced to 30 days; event/action-log retention can also be configured.',
        shortValue: 'Yes, configurable audit and event retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/audit-logs/',
            label: 'Audit logs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/tines-security-best-practices/',
            label: 'Tines security best practices | Tines',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Security guidance gives seven days as paid-plan event retention by default, configurable down to one hour. These figures describe Stories rather than every 3B resource.',
      },
      piiRedaction: {
        value:
          'Stories guidance describes configuring Event Transforms to mask sensitive data before it reaches an agent. A universal automatic PII detector or log-redaction control was not verified.',
        shortValue: 'Configured masking transforms; universal detector unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/blog/building-ai-agents-getting-started/',
            label: 'Tines Stories agent security guidance',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Yes: Stories supports SAML/OIDC SSO; users must be invited or JIT provisioning must be enabled to join a tenant.',
        shortValue: 'Yes, SSO with optional JIT provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/single-sign-on/',
            label: 'Single sign-on',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/tines-security-best-practices/',
            label: 'Tines security best practices | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-stories-pricing-and-packaging',
            label: 'Understanding Tines Stories pricing and packaging',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'SSO is listed across Stories plans; JIT provisioning is a separately packaged team feature.',
      },
      sessionPolicy: {
        value:
          'Yes: Tines documents administrator-configurable inactivity timeouts, with a one-day default in its Stories security guidance.',
        shortValue: 'Yes, configurable inactivity timeout',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/tines-security-best-practices/',
            label: 'Tines security best practices | Tines',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A separate absolute lifetime cap and product-specific 3B timeout ranges were not verified.',
      },
      thirdPartyVetting: {
        value:
          'Stories supplies actions and templates, while customers can add private templates and remote MCP tools; 3B runs authored code and dependencies. Universal vendor vetting of these extensions was not verified.',
        shortValue: 'Vendor actions plus customer tools and dependencies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/private-templates/',
            label: 'Private Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Stories shows action/event routes and run timing; AI Agent output includes tool conversation steps and model/token metadata.',
        shortValue: 'Stories event paths, timings, and AI tool steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/story-runs/',
            label: 'Story runs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Stories supports configured HTTP retries with backoff and failure paths. 3B code steps can be configured for retries; whole-run exactly-once recovery was not verified.',
        shortValue: 'Configured retries and error routing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/types/http-request/',
            label: 'HTTP Request',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: Stories notifies on exhausted HTTP retries and supports AI token thresholds that notify or disable an action.',
        shortValue: 'Yes, failure and AI usage notifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/http-request-action-retries-without-notification/',
            label: 'Tines Stories: Http request action retries without notification',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/ai-agent/',
            label: 'AI Agent',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Stories exports audit logs to S3 every 15 minutes; 3B forwards audit logs to configured HTTPS destinations.',
        shortValue: 'Yes, Stories S3 exports and 3B HTTPS destinations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/admin/audit-logs/',
            label: 'Audit logs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16051171-monitor-tenant-activity-in-the-audit-logs',
            label: 'Tines 3B audit logs',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: a Stories response-enabled webhook continues running after the synchronous response timeout and supplies a URL to retrieve a later result.',
        shortValue: 'Yes, continued runs with later result retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/apis/',
            label: 'Workflows as APIs',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Stories MCP tools have a 30-second response deadline and a tenant-wide cap of 100 concurrent calls, or 1,000 on dedicated tenants, shared with response-enabled webhooks.',
        shortValue: 'Stories MCP: 30 seconds; 100/1,000 concurrent calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/actions/templates/mcp-server/',
            label: 'MCP server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/tools/run-script/',
            label: 'Run script',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/16050928-build-a-workflow-in-your-own-coding-tools',
            label: 'Build a workflow in your own coding tools | Tines 3B Docs',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The underlying run may continue after the response deadline. Stories Run Script defaults to 10 seconds and supports up to 110 seconds. 3B code-step timeouts range from 1 to 300 seconds and default to 45 seconds; these are step limits, not a universal whole-workflow duration.',
      },
      partialFailureHandling: {
        value:
          'Yes: Stories failure paths send actions with error logs to an alternate branch; HTTP actions can emit a failure after retries are exhausted.',
        shortValue: 'Yes, alternate failure paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/whats-new/failure-path-for-actions/',
            label: 'Tines Stories: Failure path for actions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/docs/actions/types/http-request/',
            label: 'HTTP Request',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes: live workflows run on schedules and events in the deployed service. Stories drafts stop processing after 30 minutes of inactivity; 3B drafts do not run automatic triggers.',
        shortValue: 'Yes, live workflows; drafts have execution restrictions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/stories/docs/stories/change-control/',
            label: 'Change Control',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.3b.tines.com/en/articles/15877997-branches',
            label: 'Tines 3B branches',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/stories/whats-new/schedule-with-cron-expressions/',
            label: "Schedule with cron expressions | What's new at Tines",
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Email, web support requests, and in-product chat; paid support coverage depends on the purchased support level.',
        shortValue: 'Email, web requests, and in-product chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/support-services-policy-feb-2024/',
            label: 'Tines support services policy',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'The public support policy specifies response targets by priority and support level, and explicitly says first-response times are not guaranteed.',
        shortValue: 'Support response targets, subject to contract',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/support-services-policy-feb-2024/',
            label: 'Tines support services policy',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A generally applicable contractual uptime percentage was not verified in the reviewed sources.',
      },
      community: {
        value:
          'Tines provides a community forum, Stories University, and a public workflow library.',
        shortValue: 'Community, Stories University, and workflow library',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/pricing/',
            label: 'Pricing | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/university/',
            label: 'Learn how to build with Tines Stories University | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/library/',
            label: 'Home | Stories | Library',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'Tines announced a $125 million Series C at a $1.125 billion valuation in February 2025.',
        shortValue: 'Series C announced February 2025',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/blog/series-c-fundraise/',
            label: 'Tines Series C announcement',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is a historical financing milestone, not a claim about its present valuation.',
      },
      academy: {
        value:
          'Yes: Stories University has role-based learning paths, with separate Core and Advanced certification programs.',
        shortValue: 'Yes, University paths and certification programs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/university/',
            label: 'Learn how to build with Tines Stories University | Tines',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.tines.com/get-certified/',
            label: 'Get certified | Tines',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
