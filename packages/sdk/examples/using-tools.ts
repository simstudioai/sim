import { SimStudio } from '../src'
import { AgentBlock } from '../src/blocks/agent'

/**
 * Example showing how to use tools with agent blocks
 */
async function usingToolsExample() {
  const simStudio = new SimStudio({
    apiKey: 'your-api-key', // Replace with your actual API key
  })

  // Create a workflow
  const workflow = simStudio.createWorkflow(
    'Research Assistant', 
    'Research a topic and summarize findings'
  )

  // Create the agent block with tools
  const researchAgentBlock = new AgentBlock({
    model: 'claude-3-opus',
    prompt: 'Research the topic "{{input.topic}}" and provide a comprehensive summary. Use the search tools to gather information.',
    systemPrompt: 'You are a research assistant that can search the web for information and compile comprehensive reports.',
    temperature: 0.5,
    tools: [], // Will be populated with tool references
    apiKey: 'your-agent-api-key' // Now included directly in options
  }).setName('Research Agent')

  // Reference built-in tools by their IDs
  // The system will automatically transform these references into tool definitions
  researchAgentBlock.data.toolReferences = ['tavily_search', 'serper_search']
  
  // Configure tool settings with required parameters
  researchAgentBlock.data.toolSettings = {
    // Each tool gets its required parameters
    tavily_search: {
      apiKey: 'your-tavily-api-key'
    },
    serper_search: {
      apiKey: 'your-serper-api-key'
    }
  }

  // Add the agent to the workflow
  workflow.addBlock(researchAgentBlock)

  // For custom tools, users can still define them directly if needed
  // This is equivalent to when a user creates a custom tool in the UI
  const customTool = {
    name: 'findCompany',
    description: 'Find information about a company by name',
    parameters: {
      type: 'object',
      properties: {
        companyName: {
          type: 'string',
          description: 'The name of the company to find information about'
        },
        detailLevel: {
          type: 'string',
          enum: ['basic', 'detailed'],
          description: 'The level of detail to return',
          default: 'basic'
        }
      },
      required: ['companyName']
    }
  }
  
  // Add the custom tool to the agent
  if (!researchAgentBlock.data.tools) {
    researchAgentBlock.data.tools = []
  }
  researchAgentBlock.data.tools.push(customTool)
  
  console.log('Added tools to the agent')

  // Connect the starter block to the agent
  const starterBlock = workflow.getStarterBlock()
  workflow.connect(starterBlock.id, researchAgentBlock.id)
  
  // Build the workflow
  const builtWorkflow = workflow.build()
  console.log('Workflow built successfully with search tools')
  
  // In a real scenario, you would save and deploy the workflow
  console.log('To execute this workflow, you would:')
  console.log('1. Save the workflow: simStudio.saveWorkflow(workflow)')
  console.log('2. Deploy the workflow: simStudio.deployWorkflow(workflowId)')
  console.log('3. Execute the workflow: simStudio.executeWorkflow(workflowId, { topic: "AI ethics" })')
  
  return builtWorkflow
}

// Run the example
if (require.main === module) {
  usingToolsExample().catch(console.error)
}

export default usingToolsExample 