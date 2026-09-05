import { ZapierIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

export const zapierProfile: CompetitorProfile = {
  id: 'zapier',
  name: 'Zapier',
  website: 'https://zapier.com',
  brand: {
    icon: ZapierIcon,
    selfFramed: true,
    colors: ['#fc4c06', '#fcac7c', '#241414'],
    description:
      'Zapier is a cloud-based automation platform that connects thousands of web applications, letting users build custom workflows without coding. Linking apps like Gmail, Slack, and Salesforce, it automates repetitive tasks: moving data, triggering actions, and syncing information across services. Users build "Zaps" that define triggers and actions, so software works together.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      {
        type: 'x',
        url: 'https://x.com/zapier',
      },
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/zapier',
      },
      {
        type: 'facebook',
        url: 'https://facebook.com/ZapierApp',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/user/ZapierApp',
      },
      {
        type: 'instagram',
        url: 'https://instagram.com/popular/zapiercom',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Zapier is a proprietary cloud automation platform with visual trigger-action workflows, AI Agents, Chatbots, Copilot, and developer tools for connecting apps.',
  standoutFeatures: [
    {
      title: '9,000+ app integrations',
      description:
        'Zapier advertises more than 9,000 app integrations across its automation platform. Available actions vary by app and product.',
      shortDescription: 'Connect workflows to 9,000+ apps.',
      source: {
        url: 'https://zapier.com/apps',
        label: 'Zapier App Directory',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Hosted MCP with reusable skills',
      description:
        'Zapier MCP lets compatible AI clients discover and call connected app actions. Its saved skills package reusable instructions that clients can retrieve for recurring work.',
      shortDescription: 'App tools and reusable instructions for MCP clients.',
      source: {
        url: 'https://docs.zapier.com/mcp/overview/how-tools-work.md',
        label: 'Zapier MCP tools, discovery, and skills',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Copilot builds across products',
      description:
        'Copilot creates and refines automations from natural-language prompts across Zap workflows, Tables, Forms, Agents, and Chatbots.',
      shortDescription: 'Describe a workflow and build it with Copilot.',
      source: {
        url: 'https://zapier.com/blog/zapier-copilot-guide/',
        label: 'Zapier Copilot guide',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'US-hosted service',
      description:
        'Zapier says it stores customer data on AWS servers in the United States. This matters for teams that require a particular hosting region.',
      shortDescription: 'Customer data is hosted on AWS in the US.',
      source: {
        url: 'https://zapier.com/legal/data-privacy',
        label: 'Zapier Data Privacy Overview',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Usage depends on billable actions',
      description:
        'Successful app actions generally consume tasks, while triggers and many built-in tools are free. Successful MCP tool calls consume two tasks; Agents use a separate activity allowance.',
      shortDescription: 'Task charges vary by action; MCP calls use two tasks.',
      source: {
        url: 'https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier',
        label: 'How is task usage measured in Zapier',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Free Zaps have two steps',
      description:
        'The Free plan includes 100 tasks per month and limits Zaps to one trigger and one action. Multi-step Zaps require a paid plan.',
      shortDescription: '100 tasks per month and two-step Zaps on Free.',
      source: {
        url: 'https://zapier.com/pricing',
        label: 'Zapier pricing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Advanced governance requires Enterprise',
      description:
        'Managed app connections, publication approvals, and account analytics are documented as Enterprise features.',
      shortDescription: 'Enterprise is required for advanced administration.',
      source: {
        url: 'https://help.zapier.com/hc/en-us/articles/44796621276685-Set-up-admin-tools-for-your-Enterprise-account',
        label: 'Set up admin tools for your Enterprise account',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual trigger-action Zaps, AI Agents, and Copilot for creating and refining automations.',
        shortValue: 'Visual workflows, Agents, and Copilot',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-copilot-guide/',
            label: 'Zapier Copilot guide',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Learning effort depends on workflow complexity and user experience.',
        shortValue: 'Depends on workflow and experience',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value:
          'Zapier operates a hosted service; a self-hosted edition of the full platform was not verified.',
        shortValue: 'Hosted service; self-hosting unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Zapier Data Privacy Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/mcp/manage/security.md',
            label: 'Zapier MCP security and governance',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The MCP documentation explicitly rules out dedicated VPC and on-premises deployment for that product.',
      },
      deploymentOptions: {
        value:
          'Vendor-hosted cloud service. Zapier says customer data is stored on AWS servers in the United States.',
        shortValue: 'Vendor-hosted cloud on AWS in the US',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Zapier Data Privacy Overview',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes. Zapier publishes workflow templates and app-specific automation examples.',
        shortValue: 'Prebuilt workflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/templates',
            label: 'Zapier workflow templates',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'Proprietary service terms; Zapier and its licensors retain ownership of the service.',
        shortValue: 'Proprietary',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/legal/terms-of-service',
            label: 'Zapier Terms of Service',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Zap drafts and integration versions are documented; a platform-wide dev-to-production promotion system was not verified.',
        shortValue: 'Drafts and integration versions; promotion unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions',
            label: 'Create Zap drafts and versions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/integrations/quickstart/private-vs-public-integrations.md',
            label: 'Private and public Zapier integrations',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Drafts let a published Zap keep running while it is edited. Paid plans provide version history and rollback; Enterprise adds version comparison.',
        shortValue: 'Drafts, paid history and rollback; Enterprise comparison',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions',
            label: 'Create Zap drafts and versions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Documented history retention is one month on Professional, six months on Team, and one year on Enterprise. Restoring a version creates a draft.',
      },
      realtimeCollaboration: {
        value:
          'Shared workflows, folders, and connections are documented. Simultaneous editing of one Zap was not verified.',
        shortValue: 'Shared assets; simultaneous editing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/40368119010701-Best-practices-for-sharing-collaborating-on-and-maintaining-workflows-in-Zapier',
            label:
              'Best practices for sharing collaborating on and maintaining workflows in Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Storage by Zapier is a key-value store. A general-purpose file drive with folders and file recovery was not verified.',
        shortValue: 'Key-value storage; general file drive unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496293271053-Save-and-retrieve-data-from-Zaps-using-Storage-by-Zapier',
            label: 'Save and retrieve data from Zaps using Storage by Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Yes. Zapier Tables stores structured records with plan-based limits. Deleted records and fields can be restored from Trash for 30 days.',
        shortValue: 'Native Tables with plan-based record limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/15721386410765-Zapier-Tables-usage-limits',
            label: 'Zapier Tables usage limits',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/45396606105741-Restore-deleted-records-and-fields-from-Trash-in-Zapier-Tables',
            label: 'Restore deleted records and fields from Trash in Zapier Tables',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value:
          'Markdown formatting is documented in Canvas, Forms, and folder documentation. A standalone rich-text document editor was not verified.',
        shortValue: 'Markdown surfaces; document editor unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43579890272653-Markdown-formatting-in-Zapier',
            label: 'Markdown formatting in Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Sub-Zaps let multiple parent Zaps call reusable steps and receive returned data.',
        shortValue: 'Reusable Sub-Zaps on paid plans; beta',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/32283713627533-Understanding-Sub-Zaps',
            label: 'Understanding Sub Zaps',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Sub-Zaps are documented as beta on Professional, Team, and Enterprise. The parent waits for the Return from a Sub-Zap step.',
      },
      customBlocks: {
        value:
          'Sub-Zaps reuse workflow logic, and private integrations expose custom app triggers and actions. Publishing a Zap directly as a custom step-picker block was not verified.',
        shortValue: 'Sub-Zaps and private integrations',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/32283713627533-Understanding-Sub-Zaps',
            label: 'Understanding Sub Zaps',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/integrations/quickstart/private-vs-public-integrations.md',
            label: 'Private and public Zapier integrations',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Zapier supports models from OpenAI, Anthropic, and Google through its AI products and integrations. Availability varies by product.',
        shortValue: 'OpenAI, Anthropic, and Google models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/ai-models-on-zapier/',
            label: 'AI models on Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Zapier Agents execute multi-step tasks using instructions, connected actions, and knowledge sources.',
        shortValue: 'Dedicated Agents product for multi-step tasks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Copilot builds drafts, configures steps, and refines automations from natural-language instructions.',
        shortValue: 'Copilot builds and edits from prompts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-copilot-guide/',
            label: 'Zapier Copilot guide',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Agents can reference connected knowledge sources. Chatbots support uploaded text files, Tables, and webpages.',
        shortValue: 'Knowledge sources for Agents and Chatbots',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21960697323533-Set-up-a-chatbot',
            label: 'Set up a chatbot',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Hosted MCP servers expose connected app tools to compatible clients using Streamable HTTP, with OAuth or connection-token authentication.',
        shortValue: 'Hosted MCP over Streamable HTTP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/mcp/overview/how-connections-work.md',
            label: 'Zapier MCP connections and authentication',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/mcp/overview/how-tools-work.md',
            label: 'Zapier MCP tools, discovery, and skills',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'AI Guardrails by Zapier checks text for PII, toxicity, sentiment, and prompt attacks. A customer dataset evaluation suite was not verified.',
        shortValue: 'Native AI Guardrails; evaluation suite unconfirmed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43960366238221-How-to-get-started-with-AI-Guardrails-by-Zapier',
            label: 'How to get started with AI Guardrails by Zapier',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Checks use AWS Comprehend and Bedrock. Detection can produce false positives and false negatives.',
      },
      humanInTheLoop: {
        value:
          'Human in the Loop pauses a Zap for approval, corrected data, or additional input before continuing.',
        shortValue: 'Native approval and data-collection steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/38733184458765-Use-Human-in-the-Loop-to-pause-Zaps-pending-human-review',
            label: 'Use Human in the Loop to pause Zaps pending human review',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Available on Professional, Team, and Enterprise.',
      },
      generativeMedia: {
        value:
          'Image generation is available through app actions such as ChatGPT (OpenAI) and Eden AI.',
        shortValue: 'Image generation through connected app actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/automate-ai-images/',
            label: 'Automate AI image generation with Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Zapier MCP supports runtime discovery, enabling, and execution of app actions by compatible AI clients.',
        shortValue: 'Runtime MCP tool discovery and execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/mcp/overview/how-tools-work.md',
            label: 'Zapier MCP tools, discovery, and skills',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Automatic fallback between model providers was not verified.',
        shortValue: 'Automatic model fallback unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://zapier.com/blog/ai-models-on-zapier/',
            label: 'AI models on Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value:
          'Zapier MCP supports named, reusable Markdown skills that clients can list, retrieve, create, and update.',
        shortValue: 'Reusable MCP skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/mcp/overview/how-tools-work.md',
            label: 'Zapier MCP tools, discovery, and skills',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is documented for MCP clients; it should not be read as a claim that every Zapier AI product uses the same skill object.',
      },
      nativeChatDeployment: {
        value:
          'Zapier Chatbots have public links; Chatbots Pro and Advanced also support website embedding. Agents are personal automations and cannot be embedded as live customer-facing agents.',
        shortValue: 'Public Chatbots; embedding on paid Chatbots plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21958023866381-Share-and-embed-a-chatbot',
            label: 'Share and embed a chatbot',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Knowledge sources are documented; a retrieval view exposing individual chunks was not verified.',
        shortValue: 'Chunk-level retrieval inspection unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21960697323533-Set-up-a-chatbot',
            label: 'Set up a chatbot',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Looping iterations run in parallel. Paths branches run sequentially, left to right.',
        shortValue: 'Parallel loops; sequential Paths branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/42969233918477-Understanding-Looping-by-Zapier',
            label: 'Understanding Looping by Zapier',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288555917-Add-branching-logic-to-Zap-workflows-with-Paths',
            label: 'Add branching logic to Zap workflows with Paths',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Agents can call other Zapier agents. Support for the Agent2Agent protocol was not verified.',
        shortValue: 'Agent-to-agent calls; A2A protocol unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24593355420429-Best-practices-for-working-with-Zapier-Agents',
            label: 'Best practices for working with Zapier Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://zapier.com/blog/a2a-protocol/',
            label: 'Zapier A2A protocol explainer',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value:
          'Looping by Zapier repeats downstream steps for each item, with parallel iterations and a maximum of 500 iterations.',
        shortValue: 'Parallel iteration, up to 500 items',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/42969233918477-Understanding-Looping-by-Zapier',
            label: 'Understanding Looping by Zapier',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Documented as open beta on Professional, Team, and Enterprise; nested loops are unsupported.',
      },
    },
    integrations: {
      integrationCount: {
        value: 'Zapier advertises more than 9,000 app integrations.',
        shortValue: '9,000+ apps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/apps',
            label: 'Zapier App Directory',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Zap workflows support app-event triggers using polling or instant notifications, plus generic webhook triggers. Agents also support configured triggers.',
        shortValue: 'Polling, instant events, and webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496244568589-How-Zap-triggers-work',
            label: 'How Zap triggers work',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks',
            label: 'Trigger Zaps from webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Code by Zapier runs JavaScript and Python steps.',
        shortValue: 'JavaScript and Python',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/45405528551181-Using-Code-by-Zapier',
            label: 'Using Code by Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Paid Code steps can install public npm or PyPI packages with optional version pins. Private registries and packages requiring native binaries are unsupported.',
        shortValue: 'Public npm/PyPI packages on paid plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43800622540045-Use-third-party-packages-in-Code-steps',
            label: 'Use third party packages in Code steps',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'JavaScript packages must support ES modules; package installation has memory and time limits.',
      },
      apiPublishing: {
        value:
          'Webhook URLs can trigger Zap workflows, but their immediate response cannot be customized. Publishing a Zap as a synchronous REST endpoint returning its final result was not verified.',
        shortValue: 'Webhook triggers; synchronous API publishing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks',
            label: 'Trigger Zaps from webhooks',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Zapier provides a TypeScript SDK for calling app actions, plus a Developer Platform with CLI and visual tools for building integrations.',
        shortValue: 'TypeScript action SDK and integration developer tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/sdk/index.md',
            label: 'Zapier TypeScript SDK',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/integrations/home.md',
            label: 'Zapier integration Developer Platform',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The consumer SDK is documented as beta. Prebuilt actions and direct authenticated API requests have different governance coverage.',
      },
      mcpPublishing: {
        value:
          'Users can configure hosted MCP servers with app tools and reusable skills. Publishing an arbitrary Zap directly as an MCP tool was not verified.',
        shortValue: 'Configurable MCP servers; Zap publishing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.zapier.com/mcp/overview/how-tools-work.md',
            label: 'Zapier MCP tools, discovery, and skills',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Plans include a monthly task allowance. Successful app actions generally use tasks; triggers and many built-in tools are free. Successful MCP tool calls use two tasks, and Agents use a separate activity quota.',
        shortValue: 'Task allowances; separate Agents activities',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier',
            label: 'How is task usage measured in Zapier',
            asOf: '2026-09-04',
          },
          {
            url: 'https://zapier.com/pricing',
            label: 'Zapier pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Professional starts at $19.99 per month on the published pricing page; the selected task allowance and billing term affect the final price.',
        shortValue: 'Professional from $19.99/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/pricing',
            label: 'Zapier pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'The Free plan includes 100 tasks per month and two-step Zaps, with a trigger and one action.',
        shortValue: '100 tasks/month; two-step Zaps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/pricing',
            label: 'Zapier pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Chatbots Pro and Advanced support customer OpenAI and Anthropic API keys. Enterprise also documents Bring Your Own Model connections.',
        shortValue: 'BYOK for paid Chatbots; Enterprise BYOM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21959873616013-Use-your-own-API-key-with-a-Zapier-Chatbot',
            label: 'Use your own API key with a Zapier Chatbot',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44796621276685-Set-up-admin-tools-for-your-Enterprise-account',
            label: 'Set up admin tools for your Enterprise account',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Provider charges and Zapier product usage allowances are separate.',
      },
    },
    security: {
      dataResidency: {
        value:
          'Zapier states that customer data is hosted on AWS in the United States. MCP documentation says regional residency is unavailable unless separately agreed.',
        shortValue: 'AWS US hosting; MCP exceptions require agreement',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Zapier Data Privacy Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/mcp/manage/security.md',
            label: 'Zapier MCP security and governance',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Shared assets and connections are available on Team and Enterprise. Enterprise adds administrative roles, app and action policies, and publication approvals.',
        shortValue: 'Team sharing; Enterprise administration and policies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/pricing',
            label: 'Zapier pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44796621276685-Set-up-admin-tools-for-your-Enterprise-account',
            label: 'Set up admin tools for your Enterprise account',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Enterprise administration includes an audit log for account changes and user activity; log streams also expose asset and run events.',
        shortValue: 'Account audit log and Enterprise event streams',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44796621276685-Set-up-admin-tools-for-your-Enterprise-account',
            label: 'Set up admin tools for your Enterprise account',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43732241361421-Set-up-log-streams-to-monitor-Zap-activity',
            label: 'Set up log streams to monitor Zap activity',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Zapier publishes SOC 2 Type II and SOC 3 reports and states GDPR and CCPA compliance. Regulated healthcare data and PHI are unsupported, and Zapier does not sign BAAs.',
        shortValue: 'SOC 2 Type II, SOC 3, GDPR, CCPA',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier security and compliance',
            asOf: '2026-09-04',
          },
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Zapier Data Privacy Overview',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'SOC reports and privacy compliance statements have different scopes. The Data Privacy page explicitly excludes regulated healthcare data and PHI.',
      },
      modelAndToolGovernance: {
        value:
          'Enterprise provides app/action policies, approved connection domains, BYOM, and publication approvals. MCP enforces account-level app restrictions.',
        shortValue: 'Enterprise app/action policies, BYOM, and approvals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44796621276685-Set-up-admin-tools-for-your-Enterprise-account',
            label: 'Set up admin tools for your Enterprise account',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/mcp/manage/security.md',
            label: 'Zapier MCP security and governance',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/sdk/index.md',
            label: 'Zapier TypeScript SDK',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The TypeScript SDK documents policy enforcement for prebuilt actions; direct .fetch API calls are not governed by those policies.',
      },
      credentialGovernance: {
        value:
          'Team and Enterprise can share connections. Enterprise managed apps restrict creating, sharing, and deleting designated app connections to admins, while members use shared connections.',
        shortValue: 'Shared connections; Enterprise managed apps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496326497037-Share-app-connections-with-members-of-your-Team-or-Enterprise-account',
            label: 'Share app connections with members of your Team or Enterprise account',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44795921426317-Manage-app-connections-with-managed-apps',
            label: 'Manage app connections with managed apps',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Zapier White Label embeds integrations and automation in another product without requiring end users to have Zapier accounts. Access is limited and requires contacting Zapier.',
        shortValue: 'Limited-access White Label embedding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/white-label/getting-started',
            label: 'Zapier White Label getting started',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Partners can customize the connection experience, but third-party OAuth consent screens may still show Zapier.',
      },
      dataRetention: {
        value:
          'Default Zap Content and Zap History retention is 29–69 days. Enterprise can configure retention between 7 and 30 days.',
        shortValue: 'Enterprise retention controls: 7–30 days',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-data-retention-in-Zapier',
            label: 'Customize data retention in Zapier',
            asOf: '2026-09-04',
          },
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Zapier Data Privacy Overview',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These limits describe Zap execution content/history, not every category of data held by Zapier.',
      },
      piiRedaction: {
        value:
          'AI Guardrails can inspect text for PII. This does not establish automatic redaction of all execution logs.',
        shortValue: 'Native PII checks; log redaction unconfirmed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43960366238221-How-to-get-started-with-AI-Guardrails-by-Zapier',
            label: 'How to get started with AI Guardrails by Zapier',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The Guardrails help article states that input data can remain in application logs for seven days and Zap run history for 29–69 days.',
      },
      sso: {
        value: 'SAML 2.0 SSO with just-in-time provisioning is documented for Team and Enterprise.',
        shortValue: 'SAML SSO on Team and Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496279747085-Set-up-single-sign-on-with-SAML',
            label: 'Set up single sign on with SAML',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Zapier documents a seven-day default session duration; an identity provider can enforce a shorter session.',
        shortValue: 'Shorter sessions through the identity provider',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496279747085-Set-up-single-sign-on-with-SAML',
            label: 'Set up single sign on with SAML',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Public integrations must meet publishing requirements for security, permissions, functionality, and testing. Code-step npm and PyPI packages are not vetted or scanned by Zapier.',
        shortValue: 'Public app review; Code packages are not vetted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/integrations/publish/integration-publishing-requirements.md',
            label: 'Zapier integration publishing requirements',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43800622540045-Use-third-party-packages-in-Code-steps',
            label: 'Use third party packages in Code steps',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Public-directory integration review and customer-installed package safety are separate processes.',
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Zap History provides run and step details. Enterprise Analytics reports task usage, successful run rate, and errors.',
        shortValue: 'Run/step history and Enterprise analytics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details',
            label: 'View specific Zap run details',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/25444544607373-Review-your-account-usage-in-the-analytics-dashboard',
            label: 'Review your account usage in the analytics dashboard',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A distributed trace graph or latency-percentile dashboard was not verified.',
      },
      durabilityModel: {
        value:
          'Failed-step replay retries errored steps without repeating earlier successful actions. Paid plans add Autoreplay and a separate option to replay an entire Zap.',
        shortValue: 'Failed-step retries and whole-run replay',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay',
            label: 'What is replay',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Autoreplay makes up to five attempts with increasing delays. Filter and Paths steps are not rerun during failed-step replay.',
      },
      failureAlerting: {
        value:
          'Zapier sends error emails by default, with configurable notification frequency and custom settings for selected workflows.',
        shortValue: 'Configurable error email notifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496289225229-Manage-notifications-when-errors-occur-in-Zap-workflows',
            label: 'Manage notifications when errors occur in Zap workflows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay',
            label: 'What is replay',
            asOf: '2026-09-04',
          },
        ],
        detail: 'With Autoreplay enabled, error emails wait until the final retry fails.',
      },
      dataDrains: {
        value:
          'Enterprise Log streams send asset-management and execution-outcome events to an external HTTPS endpoint in real time.',
        shortValue: 'Enterprise webhook log streams',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43732241361421-Set-up-log-streams-to-monitor-Zap-activity',
            label: 'Set up log streams to monitor Zap activity',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Only events occurring after the stream is created are captured; historical backfill is not provided.',
      },
      asyncExecution: {
        value:
          'Incoming webhooks acknowledge receipt independently of later Zap steps; the webhook response cannot be customized to return the final workflow result.',
        shortValue: 'Webhook-triggered background execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks',
            label: 'Trigger Zaps from webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.zapier.com/powered-by-zapier/api-reference/zaps/get-zap-runs.md',
            label: 'Zap Runs API: experimental Get Zap Runs endpoint',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The public Zap Runs API documentation includes an experimental endpoint for querying runs.',
      },
      executionLimits: {
        value:
          'Zaps are limited to 100 steps. Standard Code runtime is one second on Free, 30 seconds on Professional/Team, and two minutes on Enterprise; paid actions can request extended runtime up to ten minutes.',
        shortValue: '100 steps; Code timeouts vary by plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496181445261-Zap-limits',
            label: 'Zap limits',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/45405528551181-Using-Code-by-Zapier',
            label: 'Using Code by Zapier',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Zapier and connected apps also impose rate limits. Extended Code runtime consumes additional tasks.',
      },
      partialFailureHandling: {
        value:
          'Paid plans provide error-handler paths that run alternate steps after an action fails.',
        shortValue: 'Custom error-handler paths on paid plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/22495436062605-Set-up-custom-error-handling',
            label: 'Set up custom error handling',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Error handlers disable Autoreplay for that Zap. Whole-run replay remains a separate option.',
      },
      unattendedExecution: {
        value: 'Published Zaps run through Zapier when polling or instant triggers detect events.',
        shortValue: 'Triggered workflows run on Zapier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/37518970271245-What-is-Zapier',
            label: 'What is Zapier',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496244568589-How-Zap-triggers-work',
            label: 'How Zap triggers work',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Paid plans include email support. Live chat is available on qualifying Professional plans, Team, and Enterprise; Enterprise also offers a Technical Account Manager.',
        shortValue: 'Paid email; qualifying plans add chat and account support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496213764877-Get-help-and-support-with-Zapier',
            label: 'Get help and support with Zapier',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Chat availability and response targets vary by plan. Some Enterprise contracts exclude a Technical Account Manager.',
      },
      sla: {
        value:
          'Zapier publishes support response goals, not service-level guarantees. Enterprise targets a 30-minute first email response; Team targets one hour.',
        shortValue: 'Support response goals, not guaranteed SLAs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496213764877-Get-help-and-support-with-Zapier',
            label: 'Get help and support with Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Zapier operates a public user community; a current member count was not verified.',
        shortValue: 'Public community; size unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496213764877-Get-help-and-support-with-Zapier',
            label: 'Get help and support with Zapier',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Zapier has operated for more than a decade and describes its team as fully remote.',
        shortValue: 'More than a decade; fully remote team',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/press',
            label: 'Zapier Newsroom',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Current headcount, valuation, and profitability are not asserted here.',
      },
      academy: {
        value:
          'Zapier Academy offers courses covering basic and intermediate Zaps, Copilot, and AI Agents.',
        shortValue: 'Academy courses for workflows and AI Agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.zapier.com/courses/c8a7d45c-ecf1-480f-ba21-d10f6fed4b39/sections/9d862b0e-9d34-4a8b-bae2-2f41ea87c0c3/blocks/d0216a4a-8bbe-4111-b1c2-195130dfe0f16',
            label: 'Zapier Academy AI Builder Path',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
