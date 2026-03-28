import type { Course } from '@/lib/academy/types'

/**
 * Sim Foundations — the introductory partner certification course.
 *
 * IDs must never change after a learner has started the course.
 * Lesson IDs are used as localStorage keys for completion tracking.
 * The course ID is stored on the certificate record.
 */
export const simFoundations: Course = {
  id: 'sim-foundations',
  slug: 'sim-foundations',
  title: 'Sim Foundations',
  description:
    'Master the core building blocks of Sim — the canvas, agents, data flow, control logic, and deployment — through hands-on interactive exercises on the real canvas.',
  estimatedMinutes: 75,
  modules: [
    {
      id: 'sim-foundations-m1',
      title: 'The Canvas',
      description: 'Get oriented with the Sim canvas and understand how workflows are structured.',
      lessons: [
        {
          id: 'sim-foundations-m1-l1',
          slug: 'what-is-sim',
          title: 'What is Sim?',
          lessonType: 'video',
          description:
            'A high-level look at what Sim is, the problems it solves, and what a real workflow looks like running end-to-end.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
        {
          id: 'sim-foundations-m1-l2',
          slug: 'canvas-tour',
          title: 'The Canvas Tour',
          lessonType: 'video',
          description:
            'A guided tour of the canvas: placing blocks, connecting them, using the panel, running workflows, and essential keyboard shortcuts.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m1-l3',
          slug: 'your-first-workflow',
          title: 'Your First Workflow',
          lessonType: 'exercise',
          description: 'Place an Agent block on the canvas and wire it to the Starter.',
          exerciseConfig: {
            instructions:
              "Every workflow starts with a Starter block. Drag an Agent block from the toolbar onto the canvas, then connect the Starter's output handle to the Agent's input handle. Once connected, click Run to see it execute.",
            availableBlocks: ['agent'],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 120, y: 220 },
                locked: true,
              },
            ],
            validationRules: [
              {
                type: 'block_exists',
                blockType: 'agent',
                label: 'Add an Agent block to the canvas',
              },
              {
                type: 'edge_exists',
                sourceType: 'starter',
                targetType: 'agent',
                label: 'Connect the Starter to the Agent',
              },
            ],
            hints: [
              'Find the Agent block in the toolbar on the right side of the canvas.',
              "Hover over the Starter block's right edge to reveal its output handle, then drag to the Agent block.",
            ],
            mockOutputs: {
              starter: { response: { result: 'Workflow started' }, delay: 200 },
              agent: {
                response: { content: "Hello! I'm your first Sim agent. How can I help?" },
                delay: 1200,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m1-l4',
          slug: 'canvas-concepts',
          title: 'Canvas Concepts',
          lessonType: 'quiz',
          description: 'Check your understanding of the canvas before moving on.',
          quizConfig: {
            passingScore: 75,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What is the role of the Starter block in a workflow?',
                options: [
                  'It stores data between workflow runs',
                  'It defines the trigger and initial input for a workflow',
                  'It connects to external APIs',
                  'It runs JavaScript code',
                ],
                correctIndex: 1,
                explanation:
                  'The Starter block is always the entry point. It defines how the workflow is triggered — manually, via API, via chat, or on a schedule — and what data is passed in as input.',
              },
              {
                type: 'true_false',
                question:
                  'A single block can have multiple outgoing connections to different blocks.',
                correctAnswer: true,
                explanation:
                  'Yes — blocks can fan out to multiple downstream blocks, which then run in parallel. This is how you split execution into multiple concurrent branches.',
              },
              {
                type: 'multiple_choice',
                question: 'What does connecting two blocks with an edge do?',
                options: [
                  'The second block runs immediately, regardless of the first',
                  "Data flows from the source block's output to the target block's input",
                  'Both blocks are merged into one',
                  'The first block is disabled',
                ],
                correctIndex: 1,
                explanation:
                  "Edges define data flow. When a block completes, its output is passed downstream to every connected block. The target block won't start until its source has finished.",
              },
              {
                type: 'multiple_choice',
                question: 'Which keyboard shortcut copies a selected block on the canvas?',
                options: [
                  'Ctrl/Cmd + D',
                  'Ctrl/Cmd + C, then Ctrl/Cmd + V',
                  'Ctrl/Cmd + X',
                  'Alt + drag',
                ],
                correctIndex: 1,
                explanation:
                  'Ctrl/Cmd + C copies the selected block and Ctrl/Cmd + V pastes it. These are the standard copy-paste shortcuts — use them to quickly duplicate blocks on the canvas.',
              },
              {
                type: 'multiple_choice',
                question: 'What does the terminal console at the bottom of the canvas show?',
                options: [
                  'The source code of each block',
                  'Block-by-block execution output, including results and errors',
                  'A list of available integrations',
                  'The workflow deployment settings',
                ],
                correctIndex: 1,
                explanation:
                  "The terminal console shows you what happened at each block after a run: outputs, tool calls, token counts, and errors. It's your primary debugging tool.",
              },
            ],
          },
        },
      ],
    },

    {
      id: 'sim-foundations-m2',
      title: 'The Agent Block',
      description:
        'Deeply understand the core block in Sim — how agents work, how to attach tools, and how to enforce structured output.',
      lessons: [
        {
          id: 'sim-foundations-m2-l1',
          slug: 'how-agents-work',
          title: 'How Agents Work',
          lessonType: 'video',
          description:
            'The Agent block as an LLM with a job: system prompts, model selection, the tool call loop, and what the output contains.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 300,
        },
        {
          id: 'sim-foundations-m2-l2',
          slug: 'tools-and-integrations',
          title: 'Tools & Integrations',
          lessonType: 'video',
          description:
            'How to attach tools to an Agent, how the model decides when to call them, and how to connect credentials.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m2-l3',
          slug: 'structured-output',
          title: 'Structured Output',
          lessonType: 'video',
          description:
            'How to use Response Format to enforce a JSON schema on agent output, and how to reference individual fields downstream.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m2-l4',
          slug: 'configure-agent',
          title: 'Configure an Agent',
          lessonType: 'exercise',
          description:
            'The Agent block is already wired up. Open its panel and add a system prompt in the Messages field.',
          exerciseConfig: {
            instructions:
              'The Agent block is already connected to the Starter. Click it to open the panel on the right, then add a system message in the Messages field — try something like "You are a helpful assistant that answers concisely." Once set, click Run.',
            availableBlocks: [],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 80, y: 220 },
                locked: true,
              },
              {
                id: 'agent-1',
                type: 'agent',
                position: { x: 380, y: 220 },
                locked: false,
                subBlocks: { model: 'claude-sonnet-4-5' },
              },
            ],
            initialEdges: [
              {
                id: 'e-starter-agent',
                source: 'starter-1',
                target: 'agent-1',
                sourceHandle: 'source',
                targetHandle: 'target',
              },
            ],
            validationRules: [
              {
                type: 'block_configured',
                blockType: 'agent',
                subBlockId: 'messages',
                valueNotEmpty: true,
                label: 'Add a system prompt in the Messages field',
              },
            ],
            hints: [
              'Click the Agent block to select it — the configuration panel opens on the right.',
              'In the Messages section, add a system message. Try: "You are a helpful assistant that answers concisely."',
            ],
            mockOutputs: {
              starter: { response: { result: 'Workflow started' }, delay: 200 },
              'agent-1': {
                response: {
                  content: "Hello! I'm your configured Sim agent. How can I help you today?",
                },
                delay: 1800,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m2-l5',
          slug: 'agent-mastery-check',
          title: 'Agent Mastery Check',
          lessonType: 'quiz',
          quizConfig: {
            passingScore: 80,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What is the primary purpose of a system prompt on an Agent block?',
                options: [
                  "It sets the model's temperature and token limit",
                  "It defines the agent's persona, instructions, and constraints",
                  'It controls which tools the agent is allowed to call',
                  'It specifies the JSON schema for the response',
                ],
                correctIndex: 1,
                explanation:
                  "The system prompt gives the model its identity and instructions — its role, tone, what it should and shouldn't do. Temperature, tools, and response format are configured separately.",
              },
              {
                type: 'true_false',
                question:
                  'An Agent can call multiple tools in sequence during a single workflow run before producing its final answer.',
                correctAnswer: true,
                explanation:
                  'Agents run a tool call loop: the model calls a tool, receives the result, decides if it needs more information, and can call another tool before producing its final answer.',
              },
              {
                type: 'multiple_choice',
                question:
                  'You define a Response Format with a field called "sentiment" on an Agent block. What happens to that field?',
                options: [
                  "It's only available inside the Agent block and can't be used downstream",
                  'It becomes a named output on the Agent block, selectable via the reference picker in any downstream block',
                  'It must be extracted manually using a Function block',
                  "It's merged into the agent's plain-text content output",
                ],
                correctIndex: 1,
                explanation:
                  "Fields defined in a Response Format become individual outputs on the Agent block — instead of just a single 'content' string, you get 'sentiment', 'score', etc. as separate values. In any downstream block, type < to open the reference picker and select exactly the field you need.",
              },
              {
                type: 'multiple_choice',
                question: 'What does setting a tool\'s usage mode to "forced" do?',
                options: [
                  'The tool runs before the agent sees the input',
                  'The model must call that tool at least once during the run',
                  'The tool is required to return a valid response or the workflow fails',
                  'The tool is hidden from the model but runs automatically',
                ],
                correctIndex: 1,
                explanation:
                  'Forced mode guarantees the model will call that specific tool — useful when you always need a web search or database lookup regardless of what the user asked. "Auto" lets the model decide.',
              },
              {
                type: 'multi_select',
                question:
                  'Which of these can you attach directly to an Agent block? (select all that apply)',
                options: [
                  'A system prompt',
                  'External tools (search, Slack, GitHub, etc.)',
                  'Custom skills defined in workspace settings',
                  'A response format / JSON schema',
                  'A deployment schedule',
                ],
                correctIndices: [0, 1, 2, 3],
                explanation:
                  'System prompts, tools, skills, and response format are all configured directly on the Agent block. Deployment schedules are set on the Starter block, not the Agent.',
              },
            ],
          },
        },
      ],
    },

    {
      id: 'sim-foundations-m3',
      title: 'Data Flow & Variables',
      description:
        'Understand how data moves between blocks and how to reference outputs across your workflow.',
      lessons: [
        {
          id: 'sim-foundations-m3-l1',
          slug: 'variables-and-references',
          title: 'Variables & References',
          lessonType: 'video',
          description:
            'The <block.field> reference syntax, the Variables block, environment variables, and live value preview.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m3-l2',
          slug: 'multi-step-pipeline',
          title: 'Build a Multi-Step Pipeline',
          lessonType: 'exercise',
          description:
            'Chain two Agent blocks together so the output of the first flows into the second.',
          exerciseConfig: {
            instructions:
              "Add two Agent blocks to the canvas. Connect the Starter to the first Agent, then the first Agent to the second Agent. This creates a pipeline where data flows through both agents in sequence. In the second agent's Messages field, type < to open the reference picker and select the first agent's output — this is how any block feeds its result into the next one.",
            availableBlocks: ['agent'],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 80, y: 240 },
                locked: true,
              },
            ],
            validationRules: [
              {
                type: 'block_exists',
                blockType: 'agent',
                count: 2,
                label: 'Add two Agent blocks to the canvas',
              },
              {
                type: 'edge_exists',
                sourceType: 'starter',
                targetType: 'agent',
                label: 'Connect the Starter to the first Agent',
              },
              {
                type: 'edge_exists',
                sourceType: 'agent',
                targetType: 'agent',
                label: 'Connect the first Agent to the second Agent',
              },
            ],
            hints: [
              'Drag two Agent blocks onto the canvas and position them left to right.',
              'Connect Starter → Agent 1 first, then Agent 1 → Agent 2.',
              "In the second agent's Messages field, type < to open the reference picker and select the first agent's output.",
            ],
            mockOutputs: {
              starter: { response: { result: 'Workflow started' }, delay: 200 },
              agent: {
                response: { content: 'Step one complete. Passing result to the next agent.' },
                delay: 1000,
              },
            },
          },
        },
      ],
    },

    {
      id: 'sim-foundations-m4',
      title: 'Control Flow',
      description:
        "Build workflows that branch, route, run in parallel, and loop using Sim's control flow blocks.",
      lessons: [
        {
          id: 'sim-foundations-m4-l1',
          slug: 'conditions-and-routing',
          title: 'Conditions & Routing',
          lessonType: 'video',
          description:
            'The Condition block for deterministic branching, the Router block for LLM-powered routing, and when to use each.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 300,
        },
        {
          id: 'sim-foundations-m4-l2',
          slug: 'parallel-and-loops',
          title: 'Parallel Execution & Loops',
          lessonType: 'video',
          description:
            'How to run branches simultaneously with fan-out, how the Loop block iterates over a list one item at a time, and how the Parallel block processes all items in a list concurrently.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
        {
          id: 'sim-foundations-m4-l3',
          slug: 'branching-workflow',
          title: 'Branching Workflow',
          lessonType: 'exercise',
          description:
            'Build a workflow that routes to different Agent blocks depending on whether a condition is true or false.',
          exerciseConfig: {
            instructions:
              "Build a branching workflow. First, add a Condition block and connect the Starter to it. Then add two Agent blocks and connect one to each of the Condition's output handles — the top handle is the true branch, the bottom handle is the false branch. The Condition evaluates a JavaScript expression and routes execution to whichever branch matches.",
            availableBlocks: ['condition', 'agent'],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 80, y: 260 },
                locked: true,
              },
            ],
            validationRules: [
              {
                type: 'block_exists',
                blockType: 'condition',
                label: 'Add a Condition block',
              },
              {
                type: 'block_exists',
                blockType: 'agent',
                count: 2,
                label: 'Add two Agent blocks (one for each branch)',
              },
              {
                type: 'edge_exists',
                sourceType: 'starter',
                targetType: 'condition',
                label: 'Connect the Starter to the Condition',
              },
              {
                type: 'edge_exists',
                sourceType: 'condition',
                targetType: 'agent',
                sourceHandle: 'condition-if',
                label: 'Connect the Condition true branch (top handle) to an Agent',
              },
              {
                type: 'edge_exists',
                sourceType: 'condition',
                targetType: 'agent',
                sourceHandle: 'condition-else',
                label: 'Connect the Condition false branch (bottom handle) to an Agent',
              },
            ],
            hints: [
              'Add a Condition block — it shows two output handles on the right: the top one is the true branch, the bottom one is the false branch.',
              'Connect Starter → Condition first, then add two Agent blocks and drag one connection from each output handle to an Agent.',
              "Click the Condition block to set your expression. Try `true` to always take the true branch while you're testing the wiring.",
            ],
            mockOutputs: {
              starter: { response: { result: 'Workflow started' }, delay: 200 },
              condition: {
                response: { result: true },
                delay: 400,
              },
              agent: {
                response: { content: 'Taking the true path — condition was met.' },
                delay: 1200,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m4-l4',
          slug: 'control-flow-check',
          title: 'Control Flow Check',
          lessonType: 'quiz',
          quizConfig: {
            passingScore: 75,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What does the Condition block evaluate?',
                options: [
                  'A natural language description of a rule',
                  'A JavaScript expression that resolves to true or false',
                  'A SQL query against the workflow state',
                  'An LLM call that decides which path to take',
                ],
                correctIndex: 1,
                explanation:
                  'The Condition block evaluates a JavaScript expression — you can reference block outputs like <agent.sentiment> === "negative" or <start.input>.length > 100. It routes to the true or false branch based on the result.',
              },
              {
                type: 'multiple_choice',
                question: 'When would you choose a Router block over a Condition block?',
                options: [
                  'When you need an exact boolean true/false decision',
                  'When you have 3 or more named paths and natural language input determines the route',
                  'When you want to run two branches simultaneously',
                  'When you need to loop over a list of items',
                ],
                correctIndex: 1,
                explanation:
                  'The Router uses an LLM to intelligently select from multiple named paths — ideal for open-ended inputs like support tickets that could be billing, technical, or general. Condition is better for deterministic boolean logic.',
              },
              {
                type: 'true_false',
                question: "Blocks on a branch that wasn't taken still execute with an empty input.",
                correctAnswer: false,
                explanation:
                  "Blocks on a branch not taken are completely skipped — they don't run at all. Only the matching branch executes.",
              },
              {
                type: 'multiple_choice',
                question: 'How do you run two independent blocks at the same time in Sim?',
                options: [
                  'Use a dedicated Parallel block between them',
                  'Connect the same source block to both target blocks (fan-out)',
                  'Set both blocks to "async" mode in their settings',
                  'You cannot — Sim only supports sequential execution',
                ],
                correctIndex: 1,
                explanation:
                  "Fan-out: connect one block's output to multiple downstream blocks and all of them start at the same time once the source finishes. The dedicated Parallel block is different — it's a subflow container that iterates over a list and runs its inner blocks once per item, concurrently.",
              },
              {
                type: 'multiple_choice',
                question: 'How do you iterate over a list of items in Sim?',
                options: [
                  'Use the Loop block — a subflow container that runs its inner blocks once for each item in a list',
                  'By drawing an edge from a block back to an earlier block on the canvas',
                  'Use the Condition block with a counter variable that increments each pass',
                  'Loops are not supported in Sim',
                ],
                correctIndex: 0,
                explanation:
                  'Sim has a dedicated Loop block — a subflow container. You place the blocks you want to repeat inside it, point it at a list, and it runs those inner blocks once per item. Inside the loop, <loop.currentItem> gives you the current item and <loop.index> gives you the position.',
              },
            ],
          },
        },
      ],
    },

    {
      id: 'sim-foundations-m5',
      title: 'Memory & Knowledge',
      description:
        'Give agents access to documents and conversation history to build truly contextual workflows.',
      lessons: [
        {
          id: 'sim-foundations-m5-l1',
          slug: 'knowledge-bases',
          title: 'Knowledge Bases',
          lessonType: 'video',
          description:
            'What knowledge bases are, how documents are chunked and embedded, and how to wire a Knowledge block into an Agent.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m5-l2',
          slug: 'agent-memory',
          title: 'Agent Memory',
          lessonType: 'video',
          description:
            'Stateless vs stateful agents, the conversationId, and the three memory modes: full conversation, sliding window, and token window.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
      ],
    },

    {
      id: 'sim-foundations-m6',
      title: 'Deploying Your Workflow',
      description:
        'Turn a workflow into a real, production-ready product — as an API, a chat interface, or a scheduled job.',
      lessons: [
        {
          id: 'sim-foundations-m6-l1',
          slug: 'deploy-as-api',
          title: 'Deploying as an API',
          lessonType: 'video',
          description:
            'How to expose a workflow as an HTTPS REST endpoint, authenticate with API keys, and version your deployment.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m6-l2',
          slug: 'chat-deployments',
          title: 'Chat Deployments',
          lessonType: 'video',
          description:
            'Deploy a workflow as a managed chat UI — streaming responses, file uploads, conversation history, and access control.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
        {
          id: 'sim-foundations-m6-l3',
          slug: 'schedules-and-webhooks',
          title: 'Schedules & Webhooks',
          lessonType: 'video',
          description:
            'Trigger workflows automatically on a schedule with cron expressions, or on-demand via incoming webhooks.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
        {
          id: 'sim-foundations-m6-l4',
          slug: 'final-project',
          title: 'Final Project',
          lessonType: 'exercise',
          description:
            'Build a complete workflow from scratch: an Agent with a configured system prompt, routing logic via a Condition block, and separate handlers for each branch.',
          exerciseConfig: {
            instructions:
              "Build a complete multi-step workflow from scratch. Step 1: drag an Agent block onto the canvas and connect the Starter to it — this is your main processing agent. Step 2: click the Agent and add a system prompt in the Messages field. Step 3: add a Condition block and connect your Agent to it. Step 4: add two more Agent blocks and connect one to the Condition's true output and one to its false output. This pattern — intake → process → branch → handle — is the foundation of most real Sim deployments.",
            availableBlocks: ['agent', 'condition'],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 60, y: 280 },
                locked: true,
              },
            ],
            validationRules: [
              {
                type: 'edge_exists',
                sourceType: 'starter',
                targetType: 'agent',
                label: 'Connect the Starter to an Agent',
              },
              {
                type: 'block_configured',
                blockType: 'agent',
                subBlockId: 'messages',
                valueNotEmpty: true,
                label: 'Configure a system prompt on your main Agent',
              },
              {
                type: 'block_exists',
                blockType: 'condition',
                label: 'Add a Condition block',
              },
              {
                type: 'edge_exists',
                sourceType: 'agent',
                targetType: 'condition',
                label: 'Connect the Agent to the Condition',
              },
              {
                type: 'block_exists',
                blockType: 'agent',
                count: 3,
                label: 'Add two more Agent blocks for the true and false branches',
              },
              {
                type: 'edge_exists',
                sourceType: 'condition',
                targetType: 'agent',
                sourceHandle: 'condition-if',
                label: 'Connect the Condition true branch to an Agent',
              },
              {
                type: 'edge_exists',
                sourceType: 'condition',
                targetType: 'agent',
                sourceHandle: 'condition-else',
                label: 'Connect the Condition false branch to an Agent',
              },
            ],
            hints: [
              'Start by placing an Agent block and connecting it to the Starter. Click it to add a system prompt.',
              'Add a Condition block and connect your first Agent to it.',
              'Add two more Agent blocks — one for the true branch and one for the false branch.',
              'You can copy a block with Ctrl/Cmd+C and paste with Ctrl/Cmd+V to save time.',
            ],
            mockOutputs: {
              starter: { response: { result: 'Workflow started' }, delay: 200 },
              agent: {
                response: {
                  content: 'Analysis complete. Routing to the appropriate handler.',
                },
                delay: 1500,
              },
              condition: {
                response: { result: true },
                delay: 400,
              },
            },
          },
        },
      ],
    },
  ],
}
