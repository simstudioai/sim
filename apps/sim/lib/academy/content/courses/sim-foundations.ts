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
    'Learn the core building blocks of Sim — blocks, connections, agents, and automation — through hands-on interactive exercises.',
  estimatedMinutes: 45,
  modules: [
    // ─── Module 1: The Canvas ──────────────────────────────────────────────────
    {
      id: 'sim-foundations-m1',
      title: 'The Canvas',
      description: 'Get oriented with the Sim canvas and build your first workflow.',
      lessons: [
        {
          id: 'sim-foundations-m1-l1',
          slug: 'intro',
          title: 'What is Sim?',
          lessonType: 'video',
          description:
            'A quick tour of the Sim canvas: blocks, connections, and how workflows run.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 180,
        },
        {
          id: 'sim-foundations-m1-l2',
          slug: 'your-first-workflow',
          title: 'Your First Workflow',
          lessonType: 'exercise',
          description: 'Place an Agent block and wire it to the Starter.',
          exerciseConfig: {
            instructions:
              "Every workflow starts with a **Starter** block. Your job: drag an **Agent** block onto the canvas and connect the Starter's output to the Agent's input.\n\nOnce connected, click **Run** to see it execute.",
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
              { type: 'block_exists', blockType: 'agent' },
              { type: 'edge_exists', sourceType: 'starter', targetType: 'agent' },
            ],
            hints: [
              'Drag the Agent block from the toolbar on the right onto the canvas.',
              "Hover over the Starter block's right edge to reveal its output handle, then drag to the Agent block.",
            ],
            mockOutputs: {
              agent: {
                response: { result: "Hello! I'm your first Sim agent. How can I help?" },
                delay: 1200,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m1-l3',
          slug: 'canvas-concepts',
          title: 'Blocks, Handles & Connections',
          lessonType: 'quiz',
          description: 'Check your understanding of how the canvas works.',
          quizConfig: {
            passingScore: 75,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What does the Starter block do?',
                options: [
                  'Stores data between workflow runs',
                  'Defines the trigger and initial input for a workflow',
                  'Connects to external APIs',
                  'Runs JavaScript code',
                ],
                correctIndex: 1,
                explanation:
                  'The Starter block is always the entry point of a workflow. It defines how the workflow is triggered and what data is passed in.',
              },
              {
                type: 'true_false',
                question: 'A block can have multiple outgoing connections.',
                correctAnswer: true,
                explanation:
                  'Yes — blocks can fan out to multiple downstream blocks, which run in parallel.',
              },
              {
                type: 'multiple_choice',
                question: 'What happens when you connect two blocks?',
                options: [
                  'The second block runs immediately',
                  "Data flows from the source block's output to the target block's input",
                  'Both blocks are merged into one',
                  'The first block is disabled',
                ],
                correctIndex: 1,
                explanation:
                  'Connections define data flow. When the source block completes, its output is passed to the connected block as input.',
              },
              {
                type: 'multi_select',
                question: 'Which of these are valid block types in Sim? (select all that apply)',
                options: ['Agent', 'Function', 'Condition', 'Database', 'Router'],
                correctIndices: [0, 1, 2, 4],
                explanation:
                  '"Database" is not a block type — Sim connects to databases via API or Function blocks.',
              },
            ],
          },
        },
      ],
    },

    // ─── Module 2: Agents ─────────────────────────────────────────────────────
    {
      id: 'sim-foundations-m2',
      title: 'Working with Agents',
      description: 'Configure agents with system prompts, tools, and structured output.',
      lessons: [
        {
          id: 'sim-foundations-m2-l1',
          slug: 'agent-overview',
          title: 'How Agents Work',
          lessonType: 'video',
          description: 'System prompts, model selection, tools, and the response cycle.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 240,
        },
        {
          id: 'sim-foundations-m2-l2',
          slug: 'configure-agent',
          title: 'Configure an Agent',
          lessonType: 'mixed',
          description: 'Watch how to configure a system prompt, then do it yourself on the canvas.',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoDurationSeconds: 150,
          exerciseConfig: {
            instructions:
              'The Agent block is already connected. Click it to open the panel on the right, then add a **system prompt** in the Messages field.\n\nTry something like: *"You are a helpful assistant."*\n\nOnce the system prompt is set, click **Run**.',
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
                position: { x: 360, y: 220 },
                locked: false,
                subBlocks: { model: 'claude-sonnet-4-5' },
              },
            ],
            initialEdges: [
              {
                id: 'e-starter-agent',
                source: 'starter-1',
                target: 'agent-1',
                sourceHandle: 'starter-1-source',
                targetHandle: 'agent-1-target',
              },
            ],
            validationRules: [
              {
                type: 'block_configured',
                blockType: 'agent',
                subBlockId: 'messages',
                valueNotEmpty: true,
              },
            ],
            hints: [
              'Click the Agent block to select it — the panel will open on the right.',
              'In the Messages field, add a system message. Try: "You are a helpful assistant."',
            ],
            mockOutputs: {
              'agent-1': {
                response: {
                  result: "Hello! I'm your configured Sim agent. How can I help you today?",
                },
                delay: 1800,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m2-l3',
          slug: 'agent-quiz',
          title: 'Agent Concepts Check',
          lessonType: 'quiz',
          quizConfig: {
            passingScore: 80,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What is the purpose of a system prompt?',
                options: [
                  "It sets the model's temperature",
                  "It defines the agent's persona, instructions, and constraints",
                  'It controls how many tokens the model can use',
                  'It specifies which tools the agent can call',
                ],
                correctIndex: 1,
                explanation:
                  "The system prompt gives the model its instructions — its role, tone, what it should and shouldn't do.",
              },
              {
                type: 'true_false',
                question:
                  'An agent can call tools (like search or code execution) during a single workflow run.',
                correctAnswer: true,
                explanation:
                  'Agents in Sim support tool calling. The model can invoke any tool attached to it and loop until it has a final answer.',
              },
              {
                type: 'multiple_choice',
                question: 'What does "Response Format" control on an Agent block?',
                options: [
                  'The markdown styling of the output',
                  'The JSON schema the model must conform to',
                  'Which downstream block receives the output',
                  'The language the model responds in',
                ],
                correctIndex: 1,
                explanation:
                  "Response Format enforces structured output — the model's response will always match the schema you define.",
              },
              {
                type: 'multi_select',
                question:
                  'Which of these can you attach to an Agent block? (select all that apply)',
                options: [
                  'Knowledge bases',
                  'Custom tools',
                  'Sub-agents',
                  'A system prompt',
                  'A database schema',
                ],
                correctIndices: [0, 1, 2, 3],
                explanation:
                  'Agents can use knowledge bases, tools, sub-agents, and system prompts. "Database schema" is not a direct attachment.',
              },
            ],
          },
        },
      ],
    },

    // ─── Module 3: Logic & Flow ───────────────────────────────────────────────
    {
      id: 'sim-foundations-m3',
      title: 'Logic & Flow Control',
      description: 'Use Condition and Router blocks to build dynamic, branching workflows.',
      lessons: [
        {
          id: 'sim-foundations-m3-l1',
          slug: 'conditions',
          title: 'Branching with Conditions',
          lessonType: 'exercise',
          description: 'Add a Condition block to route different inputs down different paths.',
          exerciseConfig: {
            instructions:
              'Build a workflow that classifies input and takes different paths:\n\n1. Connect the **Starter** to a **Condition** block\n2. Connect the **true** path to one **Agent**, and the **false** path to another\n\nThe Condition block evaluates an expression and routes to the matching branch.',
            availableBlocks: ['condition', 'agent'],
            initialBlocks: [
              {
                id: 'starter-1',
                type: 'starter',
                position: { x: 80, y: 240 },
                locked: true,
              },
            ],
            validationRules: [
              { type: 'block_exists', blockType: 'condition' },
              { type: 'block_exists', blockType: 'agent', count: 2 },
              { type: 'edge_exists', sourceType: 'starter', targetType: 'condition' },
              { type: 'edge_exists', sourceType: 'condition', targetType: 'agent' },
            ],
            hints: [
              'Add a Condition block first — it has two output handles: true and false.',
              'Connect Starter → Condition, then add two Agent blocks and connect one to each output handle.',
            ],
            mockOutputs: {
              condition: {
                response: { result: true },
                delay: 400,
              },
              agent: {
                response: { result: 'Taking the true path — input was positive.' },
                delay: 1200,
              },
            },
          },
        },
        {
          id: 'sim-foundations-m3-l2',
          slug: 'flow-quiz',
          title: 'Flow Control Quiz',
          lessonType: 'quiz',
          quizConfig: {
            passingScore: 75,
            questions: [
              {
                type: 'multiple_choice',
                question: 'What does a Condition block output?',
                options: [
                  'A number representing the condition score',
                  'A boolean (true/false) that routes execution to the matching branch',
                  'The result of an LLM call',
                  'A list of matching records',
                ],
                correctIndex: 1,
                explanation:
                  "The Condition block evaluates an expression and routes downstream based on whether it's true or false.",
              },
              {
                type: 'true_false',
                question: 'A Router block can route to more than two branches.',
                correctAnswer: true,
                explanation:
                  'Unlike Condition (which is binary), the Router block supports any number of named output paths.',
              },
              {
                type: 'multiple_choice',
                question: "What happens to blocks on a branch that wasn't taken?",
                options: [
                  'They run with an empty input',
                  'They are skipped — only the matching branch executes',
                  'They run after a delay',
                  'They throw an error',
                ],
                correctIndex: 1,
                explanation:
                  'When a branch is not taken, all blocks on that branch are skipped. The workflow only executes the matching path.',
              },
            ],
          },
        },
      ],
    },
  ],
}
