import { SimStudio } from '../src'
import { AgentBlock } from '../src/blocks/agent'
import { FunctionBlock } from '../src/blocks/function'

/**
 * Example showing how to build and execute a workflow
 */
async function buildExecuteWorkflowExample() {
  try {
    const simStudio = new SimStudio({
      apiKey: 'your-api-key', // Replace with your actual API key
    })

    // Create a workflow
    const workflow = simStudio.createWorkflow(
      'Content Creator',
      'Generate and format a blog post from a topic'
    )

    // Create an agent block for content generation
    const contentAgentBlock = new AgentBlock({
      model: 'claude-3-opus', 
      prompt: 'Generate a blog post about {{input.topic}}. Include an introduction, 3 main points, and a conclusion.',
      temperature: 0.7,
      apiKey: 'your-agent-api-key'
    }).setName('Content Generator')

    // Create a function block for formatting
    const formatterBlock = new FunctionBlock({
      code: `
        function formatContent(input) {
          const content = input.content
          const formattedContent = {
            title: "Blog Post: " + input.topic,
            body: content,
            date: new Date().toISOString().split('T')[0],
            wordCount: content.split(' ').length
          }
          return formattedContent
        }
      `
    }).setName('Content Formatter')

    // Add blocks to the workflow
    workflow.addBlock(contentAgentBlock)
    workflow.addBlock(formatterBlock)

    // Connect blocks
    const starterBlock = workflow.getStarterBlock()
    workflow.connect(starterBlock.id, contentAgentBlock.id)
    workflow.connect(contentAgentBlock.id, formatterBlock.id)

    // Build the workflow
    const builtWorkflow = workflow.build()

    // Save the workflow
    const savedWorkflow = await simStudio.saveWorkflow(builtWorkflow)

    // Deploy the workflow
    if (savedWorkflow.id) {
      const deployment = await simStudio.deployWorkflow(savedWorkflow.id)

      // Execute the workflow
      const executionInput = {
        topic: 'The Future of Artificial Intelligence'
      }
      
      const executionResult = await simStudio.executeWorkflow(
        savedWorkflow.id,
        executionInput
      )
      
      return executionResult
    } else {
      return null
    }
  } catch (error) {
    console.error('Error in workflow execution:', error)
    throw error
  }
}

// Run the example
if (require.main === module) {
  buildExecuteWorkflowExample().catch(console.error)
}

export default buildExecuteWorkflowExample 