/**
 * Per-integration SEO/GEO overrides keyed by integration slug, authored from the
 * SEO team's on-site recommendations. Consumed at render time by the integration
 * page (`integrations/(shell)/[slug]/page.tsx`): both `generateMetadata` (title,
 * description, keywords) and the page body (H1, hero tagline, overview prose, and
 * the triggers/templates/tools section intros).
 *
 * This is NOT baked into `integrations.json` and never touches
 * `scripts/generate-docs.ts`; it augments the generated catalog purely at render
 * time. Any slug absent here renders the generated defaults unchanged. Has no app
 * runtime imports beyond the type, so it stays a cheap, reviewable data source.
 */

import type { IntegrationSeoContent } from '@/app/(landing)/integrations/data/types'

export const INTEGRATION_SEO: Record<string, IntegrationSeoContent> = {
  github: {
    title: 'GitHub Workflow Automation | Sim',
    description:
      'Build GitHub automation in Sim. Use GitHub workflow automation for pull requests, pushes, issues, and releases with AI agents.',
    keywords: ['github automation', 'github workflow automation', 'github integration'],
    h1: 'GitHub Workflow Automation and Integration',
    tagline: 'Build GitHub automation and trigger AI workflows from GitHub events.',
    overview:
      'Use Sim’s GitHub integration to run GitHub automation inside one AI workspace. Read pull requests, files, and commits; create and update issues, pull requests, branches, files, and releases; post comments and pull request reviews; and start workflows from issue, pull request, push, release, and GitHub Actions events. For example, a PR Opened trigger can start a workflow that fetches the changed files and diffs with Get PR files, then passes them to an Agent block that posts a pull request review with specific suggestions. An Issue Opened trigger can have an agent read the issue, apply labels and an assignee, and post a triage comment. A Release Published trigger can compare commits since the previous tag and send a changelog to Slack.',
    triggersIntro:
      'Sim supports GitHub webhook triggers for Issue Opened, Issue Closed, Issue Comment, PR Opened, PR Closed, PR Merged, PR Comment, PR Reviewed, Code Push, Release Published, and Actions Workflow Run. Copy the webhook URL Sim generates into your repository’s Settings > Webhooks, and the workflow starts when GitHub delivers the event instead of waiting for a scheduled check.',
    comparison: {
      id: 'github-comparison',
      heading: 'Sim vs. Zapier and n8n for GitHub',
      intro:
        'Zapier and n8n both provide GitHub integrations for general-purpose automation. Sim focuses on workflows where an Agent block reads a pull request, issue, or diff before a GitHub block comments, reviews, labels, or opens a pull request. Zapier or n8n may suit a GitHub workflow that relays events without an AI step.',
      columns: ['Sim', 'Zapier', 'n8n'],
      rows: [
        {
          label: 'Trigger model',
          values: [
            {
              text: 'Real-time webhook',
            },
            {
              text: 'Polling',
              href: 'https://zapier.com/apps/github/integrations',
            },
            {
              text: 'Webhook',
              href: 'https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.githubtrigger',
            },
          ],
        },
        {
          label: 'AI step before acting',
          values: [
            {
              text: 'Agent block, built in',
            },
            {
              text: 'Requires a separate AI step or app',
              href: 'https://zapier.com/apps/github/integrations/chatgpt',
            },
            {
              text: 'Requires a separate AI Agent node',
              href: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent',
            },
          ],
        },
        {
          label: 'Free to start',
          values: [
            {
              text: 'Yes',
            },
            {
              text: 'Yes, 100 tasks a month on two-step Zaps',
              href: 'https://zapier.com/pricing',
            },
            {
              text: 'Yes, when self-hosted',
              href: 'https://docs.n8n.io/n8n-community-license',
            },
          ],
        },
        {
          label: 'Open pull requests',
          values: [
            {
              text: 'Create pull request operation',
            },
            {
              text: 'Create Pull Request action',
              href: 'https://zapier.com/apps/github/integrations',
            },
            {
              text: 'Pull Request Create operation',
              href: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github',
            },
          ],
        },
      ],
      conclusion:
        'Choose Sim when an AI agent should read the pull request or issue and decide what to comment, label, or change, rather than relay each GitHub event unchanged.',
    },
    faqs: [
      {
        question: 'Can a Sim agent open pull requests, triage issues, and comment on GitHub?',
        answer:
          'Yes. Sim’s GitHub block includes Create pull request, Create issue comment, Create PR comment, Create PR review, Add issue labels, and Add issue assignees, and an Agent block can choose which to run. Issue Opened and PR Opened triggers start the workflow when GitHub delivers the event, so triage and review comments do not wait on a schedule.',
      },
      {
        question: 'What GitHub events can start a Sim workflow?',
        answer:
          'Sim has GitHub triggers for Issue Opened, Issue Closed, Issue Comment, PR Opened, PR Closed, PR Merged, PR Comment, PR Reviewed, Code Push, Release Published, and Actions Workflow Run. Each one uses a webhook URL that you add in your repository’s Settings > Webhooks, with an optional webhook secret.',
      },
      {
        question: 'Can Sim use a GitHub MCP server?',
        answer:
          'Sim can connect a remote MCP server that uses Streamable HTTP and give its tools to an Agent block or run them through the MCP block; local stdio servers are not supported. Sim does not ship its own GitHub MCP server, and its built-in GitHub block covers pull requests, issues, files, branches, releases, and Actions without one.',
      },
      {
        question: 'How do I connect GitHub to Sim?',
        answer:
          'Add a GitHub block to a workflow and enter a GitHub personal access token in its credential field. Choose an operation such as Get PR details or Create issue, or switch the block to trigger mode and pick a GitHub event. Test the workflow, then deploy it to run on live events.',
      },
      {
        question: 'What is the difference between Sim and Zapier for GitHub?',
        answer:
          'Zapier’s GitHub triggers poll for new data, and its free plan allows two-step Zaps, so a Zap with an AI step between the trigger and the action needs a paid plan. Sim receives GitHub webhooks directly and includes Agent blocks in every workflow. Choose Sim when an agent should read code or issue context before acting.',
      },
    ],
  },
  shopify: {
    title: 'Shopify Automation with Sim',
    description:
      'Build Shopify automation in Sim. Manage products, orders, customers, inventory, and fulfillment with AI agents. Free to start.',
    keywords: ['shopify automation', 'shopify inventory automation', 'shopify integration'],
    h1: 'Shopify Automation with Sim',
    tagline:
      'Build Shopify automation with AI agents in Sim. Manage products, variants, orders, customers, inventory, collections, and fulfillment.',
    overview:
      'Connect Shopify to Sim with OAuth and run Shopify automation from one AI workspace. Create and update products and variants, read and update orders, manage customers, check inventory levels by location, adjust inventory quantities, and create fulfillments with tracking. For example, a scheduled workflow can list inventory items, have an Agent block flag variants whose available quantity is below a threshold, and post the list to Slack. An agent can review recent orders and add tags or notes with Update Order. A restock workflow can apply an Adjust Inventory change at a location after an agent checks the received quantity.',
    comparison: {
      id: 'shopify-comparison',
      heading: 'Sim vs. Zapier and n8n for Shopify',
      intro:
        'Zapier and n8n both provide Shopify integrations, and both offer Shopify triggers that Sim does not have. Sim focuses on workflows where an Agent block reads inventory, order, or customer data and decides what to change before a Shopify block acts. Zapier or n8n may suit a workflow that must start the moment a Shopify event fires.',
      columns: ['Sim', 'Zapier', 'n8n'],
      rows: [
        {
          label: 'Trigger model',
          values: [
            {
              text: 'Scheduled; no native Shopify trigger',
            },
            {
              text: 'Instant for most events, including Updated Inventory',
              href: 'https://zapier.com/apps/shopify/integrations',
            },
            {
              text: 'Webhook',
              href: 'https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.shopifytrigger',
            },
          ],
        },
        {
          label: 'AI step before acting',
          values: [
            {
              text: 'Agent block, built in',
            },
            {
              text: 'Requires a separate AI step or app',
              href: 'https://zapier.com/apps/shopify/integrations/chatgpt',
            },
            {
              text: 'Requires a separate AI Agent node',
              href: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent',
            },
          ],
        },
        {
          label: 'Free to start',
          values: [
            {
              text: 'Yes',
            },
            {
              text: 'Yes, 100 tasks a month on two-step Zaps',
              href: 'https://zapier.com/pricing',
            },
            {
              text: 'Yes, when self-hosted',
              href: 'https://docs.n8n.io/n8n-community-license',
            },
          ],
        },
        {
          label: 'Adjust inventory',
          values: [
            {
              text: 'Adjust Inventory operation',
            },
            {
              text: 'Update Inventory Quantity action',
              href: 'https://zapier.com/apps/shopify/integrations',
            },
            {
              text: 'No inventory operation in the Shopify node',
              href: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.shopify',
            },
          ],
        },
      ],
      conclusion:
        'Choose Sim when an AI agent should review inventory and order data and decide what to flag or change on a schedule, rather than react to each Shopify event with a fixed action.',
    },
    faqs: [
      {
        question: 'Can a Sim agent update Shopify inventory and flag low stock?',
        answer:
          'Yes, on a schedule. Sim’s Shopify block can list inventory items with available and on-hand quantities, get an inventory level at a location, and change a variant’s quantity by a set amount with Adjust Inventory. A Schedule trigger can run an Agent block that flags low-stock variants and posts them to Slack, because Sim has no Shopify trigger that fires when inventory changes.',
      },
      {
        question: 'What Shopify order and inventory operations does Sim support?',
        answer:
          'Sim supports Get Order, List Orders, Update Order (note, tags, and email), and Cancel Order, plus List Inventory Items, Get Inventory Level, Adjust Inventory, and List Locations. Fulfillment operations include Create Fulfillment, List Fulfillment Orders, and Update Fulfillment Tracking. Product, variant, customer, and collection operations are also available.',
      },
      {
        question: 'Does Sim have Shopify triggers?',
        answer:
          'No. Sim does not have a native Shopify trigger, so Shopify workflows in Sim usually start from a Schedule trigger or another trigger in the workflow. If a workflow must start the moment an order or inventory event fires, Zapier and n8n both offer Shopify triggers.',
      },
      {
        question: 'How do I connect Shopify to Sim?',
        answer:
          'Add a Shopify block to a workflow and connect your store with OAuth. Choose an operation such as List Orders or Adjust Inventory, test the workflow, and deploy it. Orders normally cover the last 60 days, and older orders and protected customer fields require Shopify approval.',
      },
      {
        question: 'What is the difference between Sim and Zapier for Shopify?',
        answer:
          'Zapier offers instant Shopify triggers and inventory actions, but its free plan allows two-step Zaps, so a Zap with an AI step between the trigger and the action needs a paid plan. Sim includes Agent blocks in every workflow and runs Shopify checks on a schedule. Choose Sim when an agent should decide which products, orders, or quantities need attention.',
      },
    ],
  },
  snowflake: {
    title: 'Snowflake Automation with Sim',
    description:
      'Build Snowflake automation in Sim. Run SQL, ask Cortex Analyst, and manage warehouses and tasks with AI agents. Free to start.',
    keywords: ['snowflake automation', 'snowflake ai agent', 'snowflake integration'],
    h1: 'Snowflake Automation with Sim',
    tagline:
      'Build Snowflake automation with AI agents in Sim. Run SQL, ask Cortex Analyst, sync rows, and manage warehouses and tasks.',
    overview:
      'Connect Snowflake to Sim with a programmatic access token and run Snowflake automation from one AI workspace. Execute parameterized SQL; insert, update, upsert, and delete rows; load and unload staged data; browse databases, schemas, and tables; control warehouses and tasks; review query history; and call stored procedures. For example, a scheduled workflow can run Execute SQL against a revenue table, have an Agent block summarize the change since last week, and post the summary to Slack. An agent can answer a team question with Ask Cortex Analyst against a semantic view and return the generated SQL and results. A data operations workflow can check List Task Runs and rerun a failed task with Run Task.',
    comparison: {
      id: 'snowflake-comparison',
      heading: 'Sim vs. Zapier and n8n for Snowflake',
      intro:
        'Zapier and n8n both connect to Snowflake for SQL and row operations. Sim focuses on workflows where an Agent block queries Snowflake, interprets the results, and sends the insight to a tool such as Slack. None of the three receives instant events from Snowflake: Zapier polls for new rows, while Sim and n8n workflows start from a schedule or another trigger.',
      columns: ['Sim', 'Zapier', 'n8n'],
      rows: [
        {
          label: 'Trigger model',
          values: [
            {
              text: 'Scheduled; no native Snowflake trigger',
            },
            {
              text: 'Polling for new or updated rows',
              href: 'https://zapier.com/apps/snowflake/integrations',
            },
            {
              text: 'No Snowflake trigger node',
              href: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.snowflake',
            },
          ],
        },
        {
          label: 'AI step before acting',
          values: [
            {
              text: 'Agent block, built in',
            },
            {
              text: 'Requires a separate AI step or app',
              href: 'https://zapier.com/apps/snowflake/integrations/chatgpt',
            },
            {
              text: 'Requires a separate AI Agent node',
              href: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent',
            },
          ],
        },
        {
          label: 'Free to start',
          values: [
            {
              text: 'Yes',
            },
            {
              text: 'Yes, 100 tasks a month on two-step Zaps',
              href: 'https://zapier.com/pricing',
            },
            {
              text: 'Yes, when self-hosted',
              href: 'https://docs.n8n.io/n8n-community-license',
            },
          ],
        },
        {
          label: 'Natural-language questions',
          values: [
            {
              text: 'Ask Cortex Analyst operation',
            },
            {
              text: 'SQL and row actions only',
              href: 'https://zapier.com/apps/snowflake/integrations',
            },
            {
              text: 'SQL query, insert, and update only',
              href: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.snowflake',
            },
          ],
        },
      ],
      conclusion:
        'Choose Sim when an AI agent should query Snowflake, interpret the results, and deliver the insight, rather than move rows between tools unchanged.',
    },
    faqs: [
      {
        question: 'Which AI agent builders integrate with Snowflake for data queries?',
        answer:
          'Sim integrates with Snowflake through a block that runs parameterized SQL, lists databases, schemas, and tables, inspects schemas, and asks Cortex Analyst questions in natural language. An Agent block can choose the query, read the results, and pass them to later steps. Zapier and n8n also connect to Snowflake for SQL and row operations.',
      },
      {
        question: 'Can Sim query Snowflake and post insights to Slack?',
        answer:
          'Yes. A Sim workflow can run Execute SQL or Ask Cortex Analyst, have an Agent block summarize the results, and send the summary with a Slack block. Start it with a Schedule trigger for recurring reports, because Sim has no trigger that fires on Snowflake data changes.',
      },
      {
        question: 'Does Sim support an MCP server for querying Snowflake?',
        answer:
          'Sim can connect a remote MCP server that uses Streamable HTTP and give its tools to an Agent block, so a Snowflake MCP server your team runs can be added as agent tools. Sim does not ship its own Snowflake MCP server, and its built-in Snowflake block runs SQL and Cortex Analyst without one. Sim can also expose a deployed workflow, such as one that runs a Snowflake query, as a tool on an MCP server for external MCP clients.',
      },
      {
        question: 'How do I connect Snowflake to Sim?',
        answer:
          'Create a Snowflake programmatic access token, add a Snowflake block to a workflow, and enter the token with your account details. Choose an operation such as Execute SQL or List Tables, test the workflow, and deploy it. Execute SQL runs whatever SQL the workflow passes it, so scope the token’s role to the data the workflow needs.',
      },
      {
        question: 'What is the difference between Sim and n8n for Snowflake?',
        answer:
          'n8n’s Snowflake node runs SQL queries and inserts or updates rows, and adding AI requires a separate AI Agent node. Sim’s Snowflake block also covers upserts, staged loads and unloads, warehouses, tasks, query history, stored procedures, and Cortex Analyst, with Agent blocks built into every workflow.',
      },
    ],
  },
  outlook: {
    title: 'Outlook Automation with Sim',
    description:
      'Build Outlook automation in Sim. Send, draft, route, and manage emails with AI agents using Outlook integration.',
    keywords: ['outlook automation', 'outlook integration'],
    h1: 'Outlook Automation and Integration',
    tagline: 'Build Outlook automation for inboxes, drafts, replies, and email workflows.',
    overview:
      'Integrate Outlook into your workflow and run Outlook automation inside Sim. Send, read, draft, forward, and move email messages, or trigger workflows when new emails arrive. This Outlook integration helps teams automate inbox operations, email routing, follow-ups, and agent-driven communication from one AI workspace.',
    toolsSubtitleSuffix:
      '. Use Sim with Outlook to power Outlook automation for sending, reading, drafting, forwarding, organizing, and triggering email workflows',
  },
  box: {
    title: 'Box Workflow Automation | Box Automation with Sim',
    description:
      'Build Box workflow automation in Sim. Run Box automation for files, folders, search, and Box Sign with AI agents. Free to start.',
    keywords: ['box workflow automation', 'box automation', 'box integration'],
    h1: 'Box Integrations for Workflow Automation',
    tagline: 'Build Box workflow automation for files, folders, and e-signatures.',
    overview:
      'Use Sim’s workflow builder to run Box automation in one AI workspace. This Box integration lets you upload and download files, search content, create folders, send documents for e-signature, track signing status, and connect Box to the rest of your stack with AI agents.',
  },
  slack: {
    title: 'Slack Workflow Automation with Sim',
    description:
      'Build Slack workflow automation in Sim. Send messages, manage channels, and trigger agents with real-time Slack integration.',
    keywords: [
      'slack workflow builder',
      'slack automation',
      'slack workflow automation',
      'slack integration',
    ],
    h1: 'Slack Workflow Automation with Sim',
    tagline:
      'Build Slack workflow automation in Sim. Send, update, delete, and read messages; manage channels, users, canvases, and modals; and trigger AI agents from mentions, messages, and reactions in real time.',
    overview:
      'Sim automates Slack workflows that route messages, trigger alerts, summarize threads, update tickets, and manage incident response. Slack messages and events start agent workflows that interpret what was said and choose the next action in Slack or a connected tool, so routine coordination and time-sensitive operations keep moving without anyone relaying details by hand.',
    triggersIntro:
      'Sim supports one real-time Slack trigger. Select the Slack events you care about, such as mentions, messages, and reactions, and Sim starts the connected workflow the moment one arrives instead of waiting for a scheduled check. A monitoring alert posted in Slack can open an incident-response workflow, and a ticketing update posted in Slack can be summarised and passed to another connected tool.',
    templatesIntro:
      'Pre-built agent templates turn common Slack workflows into editable starting points: routing templates classify messages and send them to the right channel or owner, summarisation templates condense long threads into updates that preserve decisions and action items, and ticket sync and incident response templates update connected records and coordinate follow-up. Every template is editable, so you can adapt its channels, routing rules, data sources, and approval requirements.',
    toolsSubtitleSuffix:
      ' across messaging, channels, threads, users, reactions and files, and canvases and views. Combine multiple Slack actions in one workflow to summarise a message, route it, update a ticket, and post the ticket update back in Slack',
    narrativeComparison: {
      id: 'slack-automation-comparison',
      heading: 'Slack automation with Sim vs. Zapier, Make, and n8n',
      paragraphs: [
        'Sim is built for Slack workflows that need to interpret conversation context before choosing an action. A Sim agent can summarize a thread and determine whether it describes an incident before using a configured Slack or ticketing action.',
        'Zapier, Make, and n8n are useful substitutes for predefined trigger-action sequences with known conditions and branches. Choose that model when each event should produce a predictable result. For example, a simple rule that posts every new message from channel X to channel Y works well as a fixed chain because it does not require interpretation. Choose Sim when the next action depends on the meaning of a Slack conversation rather than fixed keywords or predetermined branches.',
      ],
    },
    faqs: [
      {
        question: 'What Slack workflows can Sim automate?',
        answer:
          'Slack workflow automation uses messages and channel events to start work in connected tools. Sim can route Slack messages, trigger alerts, summarize threads, update tickets, and coordinate incident response. You can use Sim to turn Slack conversations into tracked work without manually copying details.',
      },
      {
        question: 'How does routing and alerting work in Sim?',
        answer:
          'Routing and alerting send selected Slack messages to the people or channels responsible for responding. Sim uses Slack events and workflow logic to route a message or send an alert based on its content. This directs requests and incidents without requiring someone to monitor every channel.',
      },
      {
        question: 'Can Sim summarize Slack threads?',
        answer:
          'Thread summarization condenses a Slack conversation into its main points and relevant context. Sim can read a Slack thread and send the resulting summary to another Slack channel or a workflow that uses connected tools.',
      },
      {
        question: 'How does Sim update tickets from Slack?',
        answer:
          'A Slack-to-ticket workflow transfers conversation details into a connected ticketing tool. Sim can pass information from a Slack message or thread to the ticketing tool and update the matching record. You can use Sim to keep tickets current without entering the same information twice.',
      },
      {
        question: 'Does Sim support incident response in Slack?',
        answer:
          'Incident response workflows use Slack events to start response steps and coordinate follow-up. Sim can trigger an incident workflow from Slack and pass relevant context to connected response tools. This keeps responders informed and incident records current as the conversation develops.',
      },
      {
        question: 'What is the difference between Sim and Zapier for Slack?',
        answer:
          'Zapier supports trigger-action automation, while Sim centers Slack automation on workflows that can include AI agents. Sim workflows can interpret a Slack incident thread before routing the relevant information or updating a ticket. You can use Sim when the workflow needs to understand conversation context before taking action.',
      },
    ],
  },
  'twilio-sms': {
    tagline:
      'Sim connects to Twilio to let an AI agent send SMS updates when an order status changes. Connect Twilio SMS to Sim to send outbound messages and start AI workflows when Twilio reports an inbound SMS, inbound MMS, or message status change.',
    overview:
      'The Twilio SMS block sends outbound messages. Twilio SMS Received and Twilio Message Status triggers start Sim workflows from supported webhook events.',
    comparison: {
      id: 'twilio-sms-comparison',
      heading: 'Sim vs. Zapier, Make, and n8n for Twilio SMS',
      intro:
        "Zapier, Make, and n8n provide Twilio integrations for general-purpose automation. Sim focuses on AI workflows that use Agent blocks to draft or transform messages with order or customer data before a Twilio SMS block sends them. Supported Twilio webhooks can start Sim workflows without scheduled polling. Zapier, Make, or n8n may suit a Twilio workflow that does not require Sim's Agent blocks.",
      columns: ['Sim', 'Zapier', 'Make', 'n8n'],
      rows: [
        {
          label: 'Trigger model',
          values: [
            { text: 'Real-time webhook' },
            {
              text: 'Polling for new SMS',
              href: 'https://zapier.com/apps/twilio/integrations',
            },
            {
              text: 'Instant webhook',
              href: 'https://apps.make.com/twilio',
            },
            {
              text: 'Webhook',
              href: 'https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.twiliotrigger/',
            },
          ],
        },
        {
          label: 'AI drafting before send',
          values: [
            { text: 'Agent block, built in' },
            {
              text: 'Requires a separate AI step or app',
              href: 'https://zapier.com/apps/twilio/integrations/chatgpt',
            },
            {
              text: 'Requires a separate AI step or app',
              href: 'https://www.make.com/en/integrations/twilio/openai-gpt-3',
            },
            {
              text: 'Requires a separate AI node',
              href: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/',
            },
          ],
        },
        {
          label: 'Free to start',
          values: [
            { text: 'Yes' },
            {
              text: 'Yes, with a limited free tier',
              href: 'https://zapier.com/pricing',
            },
            {
              text: 'Yes, with a limited free tier',
              href: 'https://www.make.com/en/pricing',
            },
            {
              text: 'Yes, when self-hosted',
              href: 'https://docs.n8n.io/n8n-community-license',
            },
          ],
        },
      ],
      conclusion:
        'Choose Sim when the workflow needs an AI agent to read order or customer context and write the message, rather than relay a fixed template.',
    },
    triggersIntro:
      'A supported Twilio SMS webhook starts a Sim workflow when Sim receives the corresponding event. Webhook delivery removes the need for scheduled polling, but Twilio processing and network conditions can affect when Sim receives an event.',
    faqs: [
      {
        question: 'What can I do with the Twilio SMS integration?',
        answer:
          "Sim's Twilio SMS integration lets an AI agent send SMS messages and receive SMS or MMS messages inside a workflow. You can combine Twilio SMS with Agent blocks and integrations such as AgentPhone and Discord. Combining these blocks lets you generate messages and coordinate responses across supported tools in one workflow.",
      },
      {
        question: 'How do I connect Twilio SMS to Sim?',
        answer:
          'A Twilio SMS connection authorizes Sim to use the Twilio actions and triggers you configure. Create an account at sim.ai, add a Twilio SMS block to a workflow, and enter the Twilio credentials requested in the connection settings. After you choose an action or trigger and test the workflow, you can deploy it to process supported Twilio events.',
      },
      {
        question: 'How do Twilio SMS triggers work?',
        answer:
          'A Twilio SMS trigger starts a Sim workflow when its webhook receives a supported Twilio event. Add a trigger block to the workflow, then configure the generated webhook URL in the relevant Twilio settings for Twilio SMS Received or Twilio Message Status events. The configured webhooks start matching workflows without scheduled polling.',
      },
      {
        question: 'What data does a Twilio SMS trigger provide?',
        answer:
          'A Twilio SMS trigger provides the fields in the webhook payload that Twilio sends to Sim. Twilio SMS Received events include data about an inbound SMS or MMS, which the workflow can pass to Agent blocks or later steps. Available fields vary by event and payload, so inspect a test event before mapping them.',
      },
    ],
  },
  airtable: {
    title: 'Airtable Automation with Sim',
    description:
      'Build Airtable workflow automation in Sim. Sync records and run an Airtable integration with AI agents.',
    keywords: ['airtable automation', 'airtable workflow automation', 'airtable ai integration'],
    h1: 'Airtable Workflow Automation and AI Integration',
    tagline: 'Build Airtable automation for records, schema, syncs, and workflow triggers.',
    overview:
      'Use this Airtable integration to run Airtable workflow automation in Sim. List bases and tables, inspect schema, read records, create new rows, update one or many records, and launch workflows when Airtable data changes.',
    triggersIntro:
      'Connect Airtable webhooks to Sim and launch Airtable workflow automation when records are created, updated, or deleted. Pass changed fields into AI agents for enrichment, routing, validation, or notifications.',
    templatesIntro:
      'Start from Airtable automation templates for data sync, enrichment, reporting, and record-driven workflows.',
  },
  pipedrive: {
    title: 'Pipedrive Workflow Automation with Sim',
    description:
      'Build Pipedrive workflow automation in Sim. Run Pipedrive automation for deals, leads, activities, and pipelines.',
    keywords: [
      'pipedrive workflow automation',
      'pipedrive automation',
      'pipedrive integration',
      'pipedrive crm integration',
    ],
    h1: 'Pipedrive Workflow Automation',
    tagline:
      'Build Pipedrive CRM workflow automation for deals, leads, pipelines, activities, files, and mail threads in Sim’s workspace.',
    overview:
      'Use Sim for Pipedrive workflow automation across deals, contacts, leads, sales pipeline stages, projects, activities, files, and communications with powerful CRM capabilities. This Pipedrive integration helps sales teams route leads, update CRM records, trigger follow-ups, and keep pipeline data in sync from one AI workspace.',
    toolsSubtitleSuffix:
      '. Use Sim with Pipedrive for deals, leads, activities, projects, pipelines, files, and mail threads, from creating deals and leads to updating activities, retrieving files, and tracking pipeline progress',
  },
  confluence: {
    title: 'Confluence Workflow Automation with Sim',
    description:
      'Build Confluence workflow automation in Sim. Read, update and trigger pages, comments, spaces and knowledge flows.',
    keywords: ['confluence automation', 'confluence workflow automation'],
    h1: 'Confluence Workflow Automation',
    tagline:
      'Build Confluence automation for pages, comments, attachments, labels and knowledge workflows with AI agents.',
    overview:
      'Integrate Confluence into the workflow with Sim and run Confluence automation across your knowledge base. Read, create, update and delete pages, manage comments, attachments, labels and spaces, search content, and trigger downstream actions the moment Confluence changes.',
    triggersIntro:
      'Connect a Confluence webhook to Sim to start workflows and your agent runs the instant an event happens, no polling, no delay.',
    templatesIntro:
      'Ready-to-use templates for Confluence knowledge workflows. Click any template to build it instantly.',
    toolsSubtitleSuffix:
      ' for Confluence automation across pages, blog posts, comments, attachments, labels, spaces, tasks and users',
  },
  jira: {
    title: 'Jira Automation with Sim',
    description:
      'Build Jira automation in Sim. Create, update, assign, and transition issues with AI agents and real-time triggers.',
    keywords: ['jira automation', 'jira integration'],
    h1: 'Jira Automation with Sim',
    tagline:
      'Build Jira automation for issues, comments, worklogs, and status changes with AI agents and real-time triggers.',
    overview:
      'Integrate Jira into Sim’s workflow and run Jira automation to create, update, assign, and transition issues, search with JQL, manage comments and attachments, and trigger workflows from Jira webhook events. Sim and Jira integration helps teams automate project updates, sprint reporting, triage, and issue routing in one AI workspace.',
    triggersIntro:
      'Connect Jira webhooks to Sim and your agent runs the instant an event, comments, worklogs, sprints, projects, or releases change, no polling, no delay.',
  },
  salesforce: {
    title: 'Salesforce CRM Automation with Sim',
    description:
      'Automate Salesforce CRM with AI agents in Sim. Streamline workflows, sync data, and trigger actions automatically.',
    keywords: ['salesforce automation', 'salesforce workflow automation', 'salesforce integration'],
    h1: 'Salesforce CRM Automation',
    tagline: 'Interact with Salesforce CRM or trigger workflows from Salesforce events.',
    overview:
      'Integrate Salesforce CRM into your workflow. Automate your CRM by managing accounts, contacts, leads, opportunities, cases, and tasks, all with powerful workflow automation. Use Sim’s AI agents to keep your Salesforce data in sync, automate follow-ups, and eliminate manual CRM work.',
    triggersIntro:
      'Connect a Salesforce webhook to Sim and your agent runs the instant an event happens, no polling, no delay. For example, trigger a workflow when a new Salesforce record is created or an opportunity stage changes, and let Sim handle the automation immediately.',
  },
  hubspot: {
    title: 'HubSpot CRM Automation with Sim',
    description:
      'Build HubSpot automation workflows in Sim. Automate CRM updates, triggers, and follow-ups with AI agents. Free to start.',
    keywords: [
      'hubspot automation',
      'hubspot workflow',
      'hubspot automation workflows',
      'hubspot integration',
    ],
    h1: 'HubSpot CRM Automation',
    tagline: 'Build HubSpot automation workflows with AI agents in Sim.',
    overview:
      'Integrate HubSpot into your workflow and run HubSpot automation inside Sim. Create, update, and manage CRM records, or trigger agents and workflows from HubSpot events. This HubSpot integration helps teams automate follow-ups, sync CRM data, and build faster HubSpot automation workflows from one AI workspace.',
    triggersIntro:
      'Connect a HubSpot webhook to Sim and trigger workflows the moment CRM activity happens. Run agents when records are created or updated, then automate routing, enrichment, follow-ups, and downstream actions without manual work.',
  },
  notion: {
    title: 'Notion Automation with Sim',
    description:
      'Build Notion automation workflows in Sim. Create, update, and manage Notion pages with AI agents.',
    keywords: ['notion automation', 'notion workflow automation', 'notion integration'],
    h1: 'Notion Automation with Sim',
    tagline: 'Build Notion workflow automation with AI agents in Sim.',
    overview:
      'Integrate Notion into your workflow and run Notion automation inside Sim. Create, update, and manage Notion pages with AI agents, or connect Notion to larger workflows across your stack. This Notion integration helps teams organize knowledge, automate page updates, and build faster Notion workflow automation from one AI workspace.',
  },
  supabase: {
    title: 'Supabase Automation with Sim',
    description:
      'Build Supabase automation in Sim. Connect your database to AI workflows and automate Supabase actions. Free to start.',
    keywords: ['supabase automation', 'supabase integration'],
    h1: 'Supabase Automation',
    tagline: 'Build Supabase automation with AI agents in Sim.',
    overview:
      'Integrate Supabase into your workflow and run Supabase automation inside Sim. Connect your database to AI agents, trigger workflows from app activity, and automate data operations across your stack. This Supabase integration helps teams move faster by connecting backend data, workflows, and AI in one workspace.',
  },
  linkedin: {
    title: 'LinkedIn Automation with Sim',
    description:
      'Build LinkedIn automation workflows in Sim. Share posts, manage your presence, and connect LinkedIn to AI agents. Free to start.',
    keywords: [
      'linkedin automation',
      'linkedin workflow',
      'linkedin workflow automation',
      'linkedin integration',
    ],
    h1: 'LinkedIn Automation',
    tagline: 'Build LinkedIn workflow automation with AI agents in Sim.',
    overview:
      'Integrate LinkedIn into your workflows and run LinkedIn automation inside Sim. Share posts to your personal feed, access LinkedIn profile information, and connect LinkedIn to the rest of your AI workspace. This LinkedIn integration helps teams manage their LinkedIn presence, publish content faster, and build repeatable LinkedIn workflows without manual posting.',
  },
  attio: {
    title: 'Attio Automation with Sim',
    description:
      'Build Attio automation in Sim. Manage CRM records, notes, tasks, lists, comments, and webhooks with AI agents. Free to start.',
    keywords: ['attio automation', 'attio integration'],
    h1: 'Attio Automation',
    tagline:
      'Build Attio automation with AI agents in Sim. Manage records, notes, tasks, lists, comments, and more in Attio CRM.',
    overview:
      'Connect Attio to Sim and run Attio automation across your CRM workflows. Manage records, notes, tasks, lists, list entries, comments, workspace members, and webhooks from one AI workspace. This Attio integration helps teams automate CRM updates, trigger agents from Attio events, and connect customer data to the rest of their go-to-market stack.',
  },
  lemlist: {
    title: 'Lemlist Automation with Sim',
    description:
      'Build Lemlist automation in Sim. Manage outreach activities, leads, replies, and emails with AI agents. Free to start.',
    keywords: ['lemlist automation', 'lemlist integration'],
    h1: 'Lemlist Automation',
    tagline:
      'Build Lemlist automation with AI agents in Sim. Manage outreach activities, leads, replies, and emails through Lemlist.',
    overview:
      'Integrate Lemlist into your workflow and run Lemlist automation inside Sim. Retrieve campaign activities and replies, get lead information, and send emails through the Lemlist inbox. This Lemlist integration helps teams automate outreach workflows, track lead engagement, respond to campaign activity, and connect Lemlist to the rest of their sales and marketing stack.',
  },
  linear: {
    title: 'Linear Automation with Sim',
    description:
      'Build Linear automation in Sim. Manage issues, projects, cycles, comments, and product workflows with AI agents. Free to start.',
    keywords: ['linear automation', 'linear workflow'],
    h1: 'Linear Automation',
    tagline:
      'Build Linear automation with AI agents in Sim. Manage issues, projects, cycles, comments, and product workflows.',
    overview:
      'Integrate Linear into your workflow and run Linear automation inside Sim. Manage issues, comments, projects, labels, workflow states, cycles, attachments, customers, and more from one AI workspace. This Linear workflow setup helps product and engineering teams automate bug triage, issue creation, project updates, sprint reporting, and cross-tool workflows triggered by Linear events.',
  },
  apollo: {
    title: 'Apollo CRM Automation with Sim',
    description:
      'Build Apollo CRM automation in Sim. Search, enrich, manage contacts, and run Apollo.io workflows with AI agents. Free to start.',
    keywords: [
      'apollo crm integration',
      'apollo crm automation',
      'apollo io workflow',
      'apollo io automation',
    ],
    h1: 'Apollo CRM Automation',
    tagline:
      'Build Apollo.io automation with AI agents in Sim. Search, enrich, and manage contacts, accounts, opportunities, and sales workflows.',
    overview:
      'Integrate Apollo into your workflow and run Apollo CRM automation inside Sim. Search for people and companies, enrich contact and account data, manage CRM contacts and accounts, add contacts to sequences, create tasks, and update opportunities from one AI workspace. This Apollo CRM integration helps sales and growth teams automate prospecting, lead enrichment, contact management, and outbound workflows without manual CRM work.',
  },
  datadog: {
    title: 'Datadog Automation with Sim',
    description:
      'Build Datadog workflow automation in Sim. Monitor apps, logs, metrics, incidents, and alerts with AI agents. Free to start.',
    keywords: ['datadog workflow automation', 'datadog automation'],
    h1: 'Datadog Automation',
    tagline:
      'Build Datadog workflow automation in Sim. Monitor apps, logs, metrics, incidents, and alerts with AI agents.',
    overview:
      'Integrate Datadog into your workflow and run Datadog automation inside Sim. Monitor infrastructure, applications, logs, metrics, incidents, dashboards, and alerts from one AI workspace. This Datadog integration helps engineering and operations teams automate observability workflows, investigate issues faster, route incidents, summarize alerts, and connect monitoring data to the rest of their stack.',
  },
}
