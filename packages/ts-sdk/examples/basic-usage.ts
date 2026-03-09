import { SimStudioClient, SimStudioError } from '../src/index'

// Example 1: Basic workflow execution
async function basicExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIM_API_KEY!,
    baseUrl: 'https://sim.ai',
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
    apiKey: process.env.SIM_API_KEY!,
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

    if (result.success) {
      console.log('✅ Workflow executed successfully!')
      console.log('Output:', result.output)
      if (result.metadata?.duration) {
        console.log('Duration:', result.metadata.duration, 'ms')
      }
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

// Example 3: Workflow validation and status checking
async function statusExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIM_API_KEY!,
  })

  try {
    // Check if workflow is ready
    const isReady = await client.validateWorkflow('your-workflow-id')
    console.log('Workflow ready:', isReady)

    // Get detailed status
    const status = await client.getWorkflowStatus('your-workflow-id')
    console.log('Status:', {
      deployed: status.isDeployed,
      needsRedeployment: status.needsRedeployment,
      deployedAt: status.deployedAt,
    })

    if (status.isDeployed) {
      // Execute the workflow
      const result = await client.executeWorkflow('your-workflow-id')

      if (result.success) {
        console.log('✅ Workflow executed successfully!')
        console.log('Output:', result.output)
      } else {
        console.log('❌ Workflow failed:', result.error)
      }
    }
  } catch (error) {
    if (error instanceof SimStudioError) {
      console.error('SDK Error:', error.message, 'Code:', error.code)
    } else {
      console.error('Unexpected error:', error)
    }
  }
}

// Example 4: Workflow execution with streaming
async function streamingExample() {
  const client = new SimStudioClient({
    apiKey: process.env.SIM_API_KEY!,
  })

  try {
    const result = await client.executeWorkflow('your-workflow-id', {
      input: {
        message: 'Count to five',
      },
      stream: true,
      selectedOutputs: ['agent1.content'], // Use blockName.attribute format
      timeout: 60000,
    })

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

// Run examples
if (require.main === module) {
  async function runExamples() {
    console.log('🚀 Running Sim SDK Examples\n')

    try {
      await basicExample()
      console.log('\n✅ Basic example completed')

      await withInputExample()
      console.log('\n✅ Input example completed')

      await statusExample()
      console.log('\n✅ Status example completed')

      await streamingExample()
      console.log('\n✅ Streaming example completed')
    } catch (error) {
      console.error('Error running examples:', error)
    }
  }

  runExamples()
}
