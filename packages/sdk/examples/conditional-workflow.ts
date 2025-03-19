import { SimStudio } from '../src'
import { AgentBlock } from '../src/blocks/agent'
import { ConditionBlock } from '../src/blocks/condition'
import { FunctionBlock } from '../src/blocks/function'

/**
 * Example showing how to create a workflow with conditional branches
 * Customer service workflow that routes inquiries to different departments
 */
async function conditionalWorkflowExample() {
  try {
    const simStudio = new SimStudio({
      apiKey: 'your-api-key', // Replace with your actual API key
    })

    // Create a workflow for handling customer inquiries
    const workflow = simStudio.createWorkflow(
      'Customer Inquiry Router',
      'Routes customer inquiries to appropriate departments based on content'
    )

    // Create a classifier agent block
    const classifierBlock = new AgentBlock({
      model: 'claude-3-haiku',
      prompt: `
        Analyze the customer inquiry: "{{input.inquiry}}"
        Determine which category it belongs to:
        - technical: Technical support requests or product troubleshooting
        - billing: Questions about billing, subscriptions, or payments
        - general: General inquiries, feedback, or other topics
        
        Output ONLY the category name as your response: technical, billing, or general.
      `,
      systemPrompt: 'You are a customer inquiry classifier. Categorize inquiries into technical, billing, or general categories.',
      temperature: 0.3,
      apiKey: 'your-agent-api-key' // Include apiKey directly
    }).setName('Inquiry Classifier')

    // Create a condition block that routes based on the classification
    const conditionData = {
      conditions: [
        { expression: 'input.classification === "technical"', id: 'technical' },
        { expression: 'input.classification === "billing"', id: 'billing' },
        { expression: 'input.classification === "general"', id: 'general' }
      ]
    }
    
    const conditionBlock = new ConditionBlock(conditionData).setName('Route Inquiry')

    // Create department-specific handler blocks
    const technicalSupportBlock = new AgentBlock({
      model: 'claude-3-sonnet',
      prompt: 'Provide technical support for the following inquiry: {{input.inquiry}}',
      systemPrompt: 'You are a technical support specialist. Provide detailed technical assistance.',
      temperature: 0.7,
      apiKey: 'your-agent-api-key' 
    }).setName('Technical Support')

    const billingSupportBlock = new AgentBlock({
      model: 'claude-3-sonnet',
      prompt: 'Address the following billing inquiry: {{input.inquiry}}',
      systemPrompt: 'You are a billing specialist. Help customers with payment and subscription issues.',
      temperature: 0.7,
      apiKey: 'your-agent-api-key' 
    }).setName('Billing Support')

    const generalSupportBlock = new AgentBlock({
      model: 'claude-3-sonnet',
      prompt: 'Address the following general inquiry: {{input.inquiry}}',
      systemPrompt: 'You are a customer support agent. Provide helpful and friendly assistance.',
      temperature: 0.7,
      apiKey: 'your-agent-api-key' 
    }).setName('General Support')

    // Add response formatter
    const formatterBlock = new FunctionBlock({
      code: `
        function formatResponse(input) {
          return {
            inquiry: input.inquiry,
            department: input.classification || "unknown",
            response: input.content,
            timestamp: new Date().toISOString()
          }
        }
      `
    }).setName('Response Formatter')

    // Add all blocks to the workflow
    workflow
      .addBlock(classifierBlock)
      .addBlock(conditionBlock)
      .addBlock(technicalSupportBlock)
      .addBlock(billingSupportBlock)
      .addBlock(generalSupportBlock)
      .addBlock(formatterBlock)

    // Connect the blocks
    const starterBlock = workflow.getStarterBlock()
    
    // Connect starter to classifier
    workflow.connect(starterBlock.id, classifierBlock.id)
    
    // Connect classifier to condition
    workflow.connect(classifierBlock.id, conditionBlock.id)
    
    // Connect condition outcomes to department-specific blocks
    workflow.connect(
      conditionBlock.id, 
      technicalSupportBlock.id, 
      { sourceHandle: 'condition-technical' }
    )
    
    workflow.connect(
      conditionBlock.id, 
      billingSupportBlock.id, 
      { sourceHandle: 'condition-billing' }
    )
    
    workflow.connect(
      conditionBlock.id, 
      generalSupportBlock.id, 
      { sourceHandle: 'condition-general' }
    )
    
    // Connect all support blocks to the formatter
    workflow.connect(technicalSupportBlock.id, formatterBlock.id)
    workflow.connect(billingSupportBlock.id, formatterBlock.id)
    workflow.connect(generalSupportBlock.id, formatterBlock.id)

    // Build the workflow
    const builtWorkflow = workflow.build()
    console.log('Conditional workflow built successfully')
    
    // Example of executing the workflow
    const workflowId = '123456' // In a real scenario, this would be the ID returned from saveWorkflow
    console.log(`To execute this workflow with an inquiry: simStudio.executeWorkflow('${workflowId}', { inquiry: "I can't login to my account" })`)
    
    return builtWorkflow
    
  } catch (error) {
    console.error('Error creating conditional workflow:', error)
    throw error
  }
}

// Run the example
if (require.main === module) {
  conditionalWorkflowExample().catch(console.error)
}

export default conditionalWorkflowExample 