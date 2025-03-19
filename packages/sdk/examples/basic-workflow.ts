import { SimStudio, AgentBlock, FunctionBlock } from '../src'

/**
 * Creates a simple workflow with Sim Studio SDK
 */
async function createBasicWorkflow() {
  const simStudio = new SimStudio({
    apiKey: 'your-api-key',
  })

  // Create a new workflow with a name and description
  const workflowBuilder = simStudio.createWorkflow(
    'Content Creation Workflow',
    'Generate and optimize content for blog posts'
  )

  // Add blocks
  const contentGeneratorBlock = new AgentBlock({
    model: 'claude-3-sonnet',
    prompt: 'Write a detailed blog post about {{input.topic}}',
    systemPrompt: 'You are a professional content writer with expertise in creating engaging blog posts.',
    temperature: 0.7,
    apiKey: 'your-agent-api-key'
  }).setName('Content Generator')

  const formatterBlock = new FunctionBlock({
    code: `
      function formatContent(input) {
        // Simple formatting function
        const title = input.topic.toUpperCase()
        const content = input.content
        const wordCount = content.split(' ').length
        
        return {
          title,
          content,
          wordCount,
          timestamp: new Date().toISOString()
        }
      }
    `,
  }).setName('Formatter')

  const seoOptimizerBlock = new AgentBlock({
    model: 'claude-3-haiku',
    prompt: 'Optimize this content for SEO: {{input.content}}',
    systemPrompt: 'You are an SEO expert. Add relevant keywords, improve readability, and optimize for search engines.',
    temperature: 0.4,
    apiKey: 'your-agent-api-key'
  }).setName('SEO Optimizer')

  // Add blocks to workflow
  workflowBuilder
    .addBlock(contentGeneratorBlock)
    .addBlock(formatterBlock)
    .addBlock(seoOptimizerBlock)

  // Connect blocks
  const starterBlock = workflowBuilder.getStarterBlock()
  workflowBuilder
    .connect(starterBlock.id, contentGeneratorBlock.id)
    .connect(contentGeneratorBlock.id, formatterBlock.id)
    .connect(formatterBlock.id, seoOptimizerBlock.id)

  // Build the workflow
  const workflow = workflowBuilder.build()

  // Execute the workflow
  try {
    const workflowId = '123456' // In a real scenario, this would be the ID returned from saveWorkflow
    const result = await simStudio.executeWorkflow(workflowId, {
      topic: 'The benefits of AI for content creation'
    })
    
  } catch (error) {
    console.error('Error executing workflow:', error)
  }
  
  return workflow
}

// Run the example
if (require.main === module) {
  createBasicWorkflow().catch(console.error)
}

export default createBasicWorkflow 