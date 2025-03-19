# Sim Studio SDK

The Sim Studio SDK allows developers to create, manage, and deploy workflows programmatically.

## Installation

```bash
npm install @sim-studio/sdk
```

## Usage

### Creating a Simple Workflow

```typescript
import { SimStudio, AgentBlock, FunctionBlock } from '@sim-studio/sdk';

// Initialize the SDK
const simStudio = new SimStudio({
  apiKey: 'your-api-key',
});

// Create a workflow
const workflow = simStudio.createWorkflow(
  'Simple Workflow',
  'A simple workflow that uses an agent to generate content'
);

// Create an agent block
const agentBlock = new AgentBlock({
  model: 'claude-3-7-sonnet',
  prompt: 'Write a blog post about <input.topic>',
  systemPrompt: 'You are a professional content writer.',
});

// Create a function block to format the content
const formatterBlock = new FunctionBlock({
  code: `
    function formatContent(input) {
      return {
        title: "Blog: " + input.topic,
        content: input.content,
        wordCount: input.content.split(' ').length
      };
    }
  `
});

// Add blocks to the workflow
workflow.addBlock(agentBlock);
workflow.addBlock(formatterBlock);

// Connect blocks
const starterBlock = workflow.getStarterBlock();
workflow.connect(starterBlock.id, agentBlock.id);
workflow.connect(agentBlock.id, formatterBlock.id);

// Build and save the workflow
const builtWorkflow = workflow.build();
simStudio.saveWorkflow(builtWorkflow)
  .then(savedWorkflow => {
    console.log(`Workflow saved with ID: ${savedWorkflow.id}`);
  });
```

### Using Tools with Agents

Agent blocks can use tools for enhanced capabilities. You can simply reference built-in tools by ID or define custom tools:

```typescript
import { SimStudio, AgentBlock } from '@sim-studio/sdk';

// Initialize the SDK
const simStudio = new SimStudio({
  apiKey: 'your-api-key',
});

// Create a workflow
const workflow = simStudio.createWorkflow('Research Assistant');

// Create an agent block
const researchAgent = new AgentBlock({
  model: 'claude-3-opus',
  prompt: 'Research the topic "{{input.topic}}" and provide a comprehensive summary.',
  systemPrompt: 'You are a research assistant.',
  tools: [] // Will be populated with tool references
});

// Reference built-in tools by their IDs
// The system will automatically transform these references into tool definitions
researchAgent.data.toolReferences = ['tavily_search', 'serper_search'];

// Configure tool settings with required parameters
researchAgent.data.toolSettings = {
  tavily_search: {
    apiKey: 'your-tavily-api-key'
  },
  serper_search: {
    apiKey: 'your-serper-api-key'
  }
};

// For custom tools, you can define them directly
const customTool = {
  name: 'findCompany',
  description: 'Find information about a company by name',
  parameters: {
    type: 'object',
    properties: {
      companyName: {
        type: 'string',
        description: 'The name of the company'
      }
    },
    required: ['companyName']
  }
};

// Add the custom tool to the agent
researchAgent.data.tools.push(customTool);

// Add to workflow
workflow.addBlock(researchAgent);

// Connect to starter
const starterBlock = workflow.getStarterBlock();
workflow.connect(starterBlock.id, researchAgent.id);

// Build and save
const builtWorkflow = workflow.build();
```

### Creating Conditional Workflows

You can create workflows with conditional branching using the ConditionBlock:

```typescript
import { SimStudio, AgentBlock, ConditionBlock } from '@sim-studio/sdk';

// Create a condition block
const conditionBlock = new ConditionBlock({
  conditions: [
    { expression: 'input.score > 0.8', id: 'high' },
    { expression: 'input.score > 0.5', id: 'medium' },
    { expression: 'true', id: 'low' }
  ]
});

// Connect condition outcomes to different blocks
workflow.connect(
  conditionBlock.id, 
  highQualityBlock.id, 
  { sourceHandle: 'condition-high' }
);

workflow.connect(
  conditionBlock.id, 
  mediumQualityBlock.id, 
  { sourceHandle: 'condition-medium' }
);

workflow.connect(
  conditionBlock.id, 
  lowQualityBlock.id, 
  { sourceHandle: 'condition-low' }
);
```

## API Reference

### SimStudio

- `createWorkflow(name, description?)`: Creates a new workflow builder
- `saveWorkflow(workflow)`: Saves a workflow and returns the saved workflow with ID
- `deployWorkflow(workflowId, options?)`: Deploys a workflow
- `executeWorkflow(workflowId, input)`: Executes a workflow with the given input

### WorkflowBuilder

- `addBlock(block)`: Adds a block to the workflow
- `connect(sourceId, targetId, options?)`: Connects two blocks
- `getStarterBlock()`: Gets the starter block
- `build()`: Builds the workflow

### Block Types

- `AgentBlock`: Agent that can generate content using LLMs
- `FunctionBlock`: Executes JavaScript code
- `ConditionBlock`: Routes based on conditions
- `RouterBlock`: Routes based on agent decisions
- `ApiBlock`: Makes HTTP requests
- `EvaluatorBlock`: Evaluates content quality

## Examples

See the [examples](./examples) directory for more examples of using the SDK.

## Features

- Create and manage workflows programmatically
- Build complex workflows with various block types
- Execute workflows and retrieve results
- Deploy workflows as API endpoints
- Schedule workflows for automatic execution

## Block Types

The SDK supports all Sim Studio block types:

- **Agent**: LLM-powered operations
- **Function**: Custom JavaScript code execution
- **Condition**: Branching based on logical expressions
- **Router**: Dynamic path selection
- **API**: HTTP requests
- **Evaluator**: LLM-based output assessment

## Documentation

For detailed documentation, visit [docs.simstudio.dev](https://docs.simstudio.dev)

## License

MIT 