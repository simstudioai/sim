import { SimStudioClient, SimStudioError } from '../src/index'

// Example 1: Basic workflow execution
async function basicExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIMSTUDIO_API_KEY!,
    baseUrl: 'https://simstudio.ai',
  })

  try {
    // Execute a workflow without input
    const result = await client.executeWorkflow('your-workflow-id')

    if (result.success) {
      console.log('✅ Workflow executed successfully!')
      console.log('Output:', result.output)
      console.log('Duration:', result.metadata?.duration, 'ms')
    } else {
      console.log('❌ Workflow failed:', result.error)
    }
  } catch (error) {
    if (error instanceof SimStudioError) {
      console.error('SDK Error:', error.message, 'Code:', error.code)
    } else {
      console.error('Unexpected error:', error)
    }
  }
}

// Example 2: Workflow execution with input data
async function withInputExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIMSTUDIO_API_KEY!,
  })

  try {
    const result = await client.executeWorkflow('your-workflow-id', {
      input: {
        message: 'Hello from SDK!',
        userId: '12345',
        data: {
          type: 'analysis',
          parameters: {
            includeMetadata: true,
            format: 'json',
          },
        },
      },
      timeout: 60000, // 60 seconds
    })

    console.log('Execution result:', result)
  } catch (error) {
    console.error('Error:', error)
  }
}

// Example 3: Workflow validation and status checking
async function statusExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIMSTUDIO_API_KEY!,
  })

  try {
    // Check if workflow is ready
    const isReady = await client.validateWorkflow('your-workflow-id')
    console.log('Workflow ready:', isReady)

    // Get detailed status
    const status = await client.getWorkflowStatus('your-workflow-id')
    console.log('Status:', {
      deployed: status.isDeployed,
      published: status.isPublished,
      needsRedeployment: status.needsRedeployment,
      deployedAt: status.deployedAt,
    })

    if (status.isDeployed) {
      // Execute the workflow
      const result = await client.executeWorkflow('your-workflow-id')
      console.log('Result:', result)
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

// Run examples
if (require.main === module) {
  console.log('🚀 Running Sim Studio SDK Examples\n')

  basicExample()
    .then(() => console.log('\n✅ Basic example completed'))
    .catch(console.error)

  withInputExample()
    .then(() => console.log('\n✅ Input example completed'))
    .catch(console.error)

  statusExample()
    .then(() => console.log('\n✅ Status example completed'))
    .catch(console.error)
}
