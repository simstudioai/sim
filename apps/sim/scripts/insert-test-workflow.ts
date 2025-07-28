#!/usr/bin/env bun

import { db } from '@/db'
import { user, workflow, workspace } from '@/db/schema'

const testWorkflowState = {
  blocks: {
    'start-block-123': {
      id: 'start-block-123',
      type: 'starter',
      name: 'Start',
      position: {
        x: 100,
        y: 100,
      },
      subBlocks: {
        startWorkflow: {
          id: 'startWorkflow',
          type: 'dropdown',
          value: 'manual',
        },
      },
      outputs: {
        response: {
          input: 'any',
        },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 90,
    },
    'loop-block-456': {
      id: 'loop-block-456',
      type: 'loop',
      name: 'For Loop',
      position: {
        x: 400,
        y: 100,
      },
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 0,
      data: {
        width: 400,
        height: 200,
        type: 'loopNode',
      },
    },
    'function-block-789': {
      id: 'function-block-789',
      type: 'function',
      name: 'Return X',
      position: {
        x: 50,
        y: 50,
      },
      subBlocks: {
        code: {
          id: 'code',
          type: 'code',
          value: "return 'X'",
        },
      },
      outputs: {
        response: {
          result: 'any',
          stdout: 'string',
        },
      },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 144,
      data: {
        parentId: 'loop-block-456',
        extent: 'parent',
      },
    },
  },
  edges: [
    {
      id: 'edge-start-to-loop',
      source: 'start-block-123',
      target: 'loop-block-456',
      sourceHandle: 'source',
      targetHandle: 'target',
    },
    {
      id: 'edge-loop-to-function',
      source: 'loop-block-456',
      target: 'function-block-789',
      sourceHandle: 'loop-start-source',
      targetHandle: 'target',
    },
  ],
  loops: {
    'loop-block-456': {
      id: 'loop-block-456',
      nodes: ['function-block-789'],
      iterations: 3,
      loopType: 'for',
      forEachItems: '',
    },
  },
  parallels: {},
  lastSaved: Date.now(),
  isDeployed: false,
}

async function insertTestWorkflow() {
  try {
    console.log('🔍 Finding first workspace and user...')

    // Get the first workspace
    const workspaces = await db.select().from(workspace).limit(1)
    if (workspaces.length === 0) {
      throw new Error('No workspaces found. Please create a workspace first.')
    }

    // Get the first user
    const users = await db.select().from(user).limit(1)
    if (users.length === 0) {
      throw new Error('No users found. Please create a user first.')
    }

    const workspaceId = workspaces[0].id
    const userId = users[0].id
    console.log(`✅ Using workspace: ${workspaceId}`)
    console.log(`✅ Using user: ${userId}`)

    // Insert workflow with old JSON state format
    const testWorkflowId = `test-migration-workflow-${Date.now()}`

    const now = new Date()

    await db.insert(workflow).values({
      id: testWorkflowId,
      name: 'Test Migration Workflow (Old JSON Format)',
      workspaceId: workspaceId,
      userId: userId,
      state: testWorkflowState, // This is the old JSON format
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      isPublished: false,
    })

    console.log(`✅ Inserted test workflow with old JSON format: ${testWorkflowId}`)
    console.log(`🌐 Access it at: http://localhost:3000/w/${testWorkflowId}`)
    console.log('')
    console.log('📋 Test steps:')
    console.log('1. Open the workflow in your browser')
    console.log('2. Verify it renders correctly with all blocks and connections')
    console.log('3. Try editing some subblock values')
    console.log('4. Run the migration script')
    console.log('5. Verify it still works after migration')
  } catch (error) {
    console.error('❌ Error inserting test workflow:', error)
    process.exit(1)
  }
}

insertTestWorkflow()
