import { SimStudio, AgentBlock, FunctionBlock, ConditionBlock, ApiBlock } from '../src'

// Initialize the SDK
const simStudio = new SimStudio({
  apiKey: 'your-api-key',
})

async function createAndDeployWorkflow() {
  // Create a workflow
  const workflowBuilder = simStudio.createWorkflow(
    'Customer Support Workflow',
    'Automatically categorize and respond to customer inquiries'
  )

  // Create blocks
  const agentBlock = new AgentBlock({
    model: 'claude-3-sonnet',
    prompt: '{{input.message}}',
    systemPrompt: 'You are a helpful customer support assistant.',
    temperature: 0.7,
    apiKey: 'your-agent-api-key'
  }).setName('Analyze Request')

  const categoryBlock = new FunctionBlock({
    code: `
      function categorize(input) {
        const message = input.content.toLowerCase()
        if (message.includes('refund')) return { category: 'refund' }
        if (message.includes('shipping')) return { category: 'shipping' }
        return { category: 'general' }
      }
      return categorize(input)
    `
  }).setName('Categorize Request')

  const routerBlock = new ConditionBlock({
    conditions: [
      { id: 'refund', expression: 'input.category === "refund"' },
      { id: 'shipping', expression: 'input.category === "shipping"' },
      { id: 'general', expression: 'true' }
    ]
  }).setName('Route Request')

  const refundBlock = new AgentBlock({
    model: 'claude-3-haiku',
    prompt: 'Create a response for this refund request: {{input.message}}',
    systemPrompt: 'You are a refund specialist.',
    apiKey: 'your-agent-api-key'
  }).setName('Handle Refund')

  const shippingBlock = new AgentBlock({
    model: 'claude-3-haiku',
    prompt: 'Create a response for this shipping request: {{input.message}}',
    systemPrompt: 'You are a shipping specialist.',
    apiKey: 'your-agent-api-key'
  }).setName('Handle Shipping')

  const generalBlock = new AgentBlock({
    model: 'claude-3-haiku',
    prompt: 'Create a response for this general request: {{input.message}}',
    systemPrompt: 'You are a general support specialist.',
    apiKey: 'your-agent-api-key'
  }).setName('Handle General')

  const slackNotificationBlock = new ApiBlock({
    url: 'https://hooks.slack.com/services/your-webhook-url',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      text: 'New customer support request processed: {{input.category}}'
    }
  }).setName('Send Slack Notification')

  // Add blocks to workflow
  workflowBuilder
    .addBlock(agentBlock)
    .addBlock(categoryBlock)
    .addBlock(routerBlock)
    .addBlock(refundBlock)
    .addBlock(shippingBlock)
    .addBlock(generalBlock)
    .addBlock(slackNotificationBlock)

  // Connect blocks
  const starterBlock = workflowBuilder.getStarterBlock()
  if (!starterBlock) {
    throw new Error("Starter block not found in workflow")
  }

  workflowBuilder
    .connect(starterBlock.id, agentBlock.id)
    .connect(agentBlock.id, categoryBlock.id)
    .connect(categoryBlock.id, routerBlock.id)
    .connect(routerBlock.id, refundBlock.id, { sourceHandle: 'condition-refund' })
    .connect(routerBlock.id, shippingBlock.id, { sourceHandle: 'condition-shipping' })
    .connect(routerBlock.id, generalBlock.id, { sourceHandle: 'condition-general' })
    .connect(refundBlock.id, slackNotificationBlock.id)
    .connect(shippingBlock.id, slackNotificationBlock.id)
    .connect(generalBlock.id, slackNotificationBlock.id)

  // Position blocks for visual layout
  workflowBuilder
    .positionBlock(starterBlock.id, 0, 0)
    .positionBlock(agentBlock.id, 200, 0)
    .positionBlock(categoryBlock.id, 400, 0)
    .positionBlock(routerBlock.id, 600, 0)
    .positionBlock(refundBlock.id, 800, -100)
    .positionBlock(shippingBlock.id, 800, 0)
    .positionBlock(generalBlock.id, 800, 100)
    .positionBlock(slackNotificationBlock.id, 1000, 0)

  // Save the workflow
  const workflow = await simStudio.saveWorkflow(workflowBuilder.build())
  
  if (!workflow.id) {
    throw new Error("Workflow ID was not returned from the server")
  }

  // Deploy the workflow
  const deployment = await simStudio.deployWorkflow(workflow.id, {
    isPublic: true,
    authentication: 'api_key',
    rateLimit: 100,
  })

  // Schedule the workflow to run daily
  const schedule = await simStudio.scheduleWorkflow(workflow.id, {
    cron: '0 9 * * 1-5', // 9 AM on weekdays
    timezone: 'America/New_York',
    enabled: true,
  })

  // Execute the workflow with sample input
  const result = await simStudio.executeWorkflow(workflow.id, {
    message: "I haven't received my order yet and it's been 2 weeks. Can you help me track my package?"
  })

  return {
    workflowId: workflow.id,
    deploymentUrl: deployment.url,
    scheduleId: schedule.id,
    executionResult: result
  }
}

// Run the example
createAndDeployWorkflow().catch(console.error) 