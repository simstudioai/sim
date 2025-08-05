/**
 * YAML Workflow Examples for Copilot
 *
 * This file contains example YAML workflows that the copilot can reference
 * when helping users build workflows.
 */

/**
 * Map of workflow examples with human-readable IDs to YAML content
 */
export const WORKFLOW_EXAMPLES: Record<string, string> = {
  'basic-agent': `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: greeting-agent
  greeting-agent:
    type: agent
    name: Greeting Agent
    inputs:
      systemPrompt: be nice
      userPrompt: <start.input>
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'`,

  tool_call_agent: `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: research-agent
  research-agent:
    type: agent
    name: Greeting Agent
    inputs:
      systemPrompt: research the topic the user provides
      userPrompt: <start.input>
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
      tools:
        - type: exa
          title: Exa
          toolId: exa_search
          params:
            type: auto
            apiKey: '{{EXA_API_KEY}}'
          isExpanded: true
          operation: exa_search
          usageControl: auto`,

  'basic-api': `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: api-call
  api-call:
    type: api
    name: API 1
    inputs:
      url: https://url
      method: POST
      params:
        - id: param-1
          cells:
            Key: queryparam1
            Value: queryval1
        - id: param-2
          cells:
            Key: queryparam2
            Value: queryval2
      headers:
        - id: header-1
          cells:
            Key: X-CSRF-HEADER
            Value: '-'
        - id: header-2
          cells:
            Key: Authorization
            Value: Bearer {{API_KEY}}
      body: |-
        {
        body
        }`,

  'multi-agent': `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: agent-1
  agent-1:
    type: agent
    name: Agent 1
    inputs:
      systemPrompt: agent1 sys
      userPrompt: agent 1 user
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
    connections:
      success:
        - agent-2
        - agent-3
  agent-2:
    type: agent
    name: Agent 2
    inputs:
      systemPrompt: agent2sys
      userPrompt: agent2 user
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
  agent-3:
    type: agent
    name: Agent 3
    inputs:
      systemPrompt: agent3 sys
      userPrompt: agent3 user
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'`,

  'iter-loop': `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: count-loop
  count-loop:
    type: loop
    name: Loop 1
    inputs:
      count: 5
      loopType: for
    connections:
      loop:
        start: loop-processor
        end: summary-agent
  summary-agent:
    type: agent
    name: Agent 2
    inputs:
      systemPrompt: outside agent sys prompt
      userPrompt: |-
        outside agent user prompt:
        <loop1.results>
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
  loop-processor:
    type: agent
    name: Agent 1
    inputs:
      systemPrompt: loop agent sys prompt
      userPrompt: |-
        loop agent user prompt
        <loop.index>
        <loop.results>
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
    parentId: count-loop`,

  'for-each-loop': `version: '1.0'
blocks:
  start:
    type: starter
    name: Start
    inputs:
      startWorkflow: chat
    connections:
      success: foreach-loop
  foreach-loop:
    type: loop
    name: Loop 1
    inputs:
      loopType: forEach
      collection: '[''item 1'', ''item 2'', ''item 3'']'
    connections:
      loop:
        start: item-processor
        end: results-summarizer
  item-processor:
    type: agent
    name: Agent 1
    inputs:
      systemPrompt: loop agent sys prompt
      userPrompt: |-
        loop agent user prompt
        ${'<'}loop.index${'>'} 
        ${'<'}loop.currentItem${'>'}
        ${'<'}loop.items${'>'}
        ${'<'}loop1.results${'>'}
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'
    parentId: foreach-loop
  results-summarizer:
    type: agent
    name: Agent 2
    inputs:
      systemPrompt: outside agent sys prompt
      userPrompt: |-
        outside agent user prompt:
        <loop1.results>
      model: gpt-4o
      apiKey: '{{OPENAI_API_KEY}}'`,

  // Targeted Update Examples - for demonstrating edit_workflow tool usage patterns
  targeted_add_block: `// Example: Adding a new agent block to an existing workflow
// Operation: Add a new block after an existing agent
{
  "operations": [
    {
      "operation_type": "add",
      "block_id": "summary-agent",
      "params": {
        "type": "agent",
        "name": "Summary Agent",
        "inputs": {
          "systemPrompt": "Summarize the conversation",
          "userPrompt": "<research-agent.response>",
          "model": "gpt-4o",
          "apiKey": "{{OPENAI_API_KEY}}"
        }
      }
    },
    {
      "operation_type": "edit",
      "block_id": "research-agent",
      "params": {
        "connections": {
          "success": "summary-agent"
        }
      }
    }
  ]
}`,

  targeted_edit_block: `// Example: Modifying an existing block's configuration
// Operation: Update system prompt and add tools to an agent
{
  "operations": [
    {
      "operation_type": "edit",
      "block_id": "research-agent",
      "params": {
        "inputs": {
          "systemPrompt": "You are a research assistant. Use web search to find current information.",
          "tools": [
            {
              "type": "exa",
              "title": "Exa Search",
              "toolId": "exa_search",
              "params": {
                "type": "auto",
                "apiKey": "{{EXA_API_KEY}}"
              },
              "isExpanded": true,
              "operation": "exa_search",
              "usageControl": "auto"
            }
          ]
        }
      }
    }
  ]
}`,

  targeted_delete_block: `// Example: Removing a block and updating connections
// Operation: Delete a block and redirect its connections
{
  "operations": [
    {
      "operation_type": "edit",
      "block_id": "start",
      "params": {
        "connections": {
          "success": "final-agent"
        }
      }
    },
    {
      "operation_type": "delete",
      "block_id": "intermediate-agent"
    }
  ]
}`,

  targeted_add_connection: `// Example: Adding new parallel connections
// Operation: Make one block connect to multiple agents
{
  "operations": [
    {
      "operation_type": "add",
      "block_id": "analysis-agent",
      "params": {
        "type": "agent",
        "name": "Analysis Agent",
        "inputs": {
          "systemPrompt": "Analyze the provided data",
          "userPrompt": "<research-agent.response>",
          "model": "gpt-4o",
          "apiKey": "{{OPENAI_API_KEY}}"
        }
      }
    },
    {
      "operation_type": "edit",
      "block_id": "research-agent",
      "params": {
        "connections": {
          "success": ["summary-agent", "analysis-agent"]
        }
      }
    }
  ]
}`,

  targeted_batch_operations: `// Example: Multiple operations in one targeted update
// Operation: Add API block, update agent, and create new connections
{
  "operations": [
    {
      "operation_type": "add",
      "block_id": "data-api",
      "params": {
        "type": "api",
        "name": "Data API",
        "inputs": {
          "url": "https://api.example.com/data",
          "method": "GET",
          "headers": [
            {
              "id": "auth-header",
              "cells": {
                "Key": "Authorization",
                "Value": "Bearer {{API_TOKEN}}"
              }
            }
          ]
        }
      }
    },
    {
      "operation_type": "edit",
      "block_id": "processing-agent",
      "params": {
        "inputs": {
          "userPrompt": "Process this data: <data-api.response>"
        }
      }
    },
    {
      "operation_type": "edit",
      "block_id": "start",
      "params": {
        "connections": {
          "success": "data-api"
        }
      }
    },
    {
      "operation_type": "add",
      "block_id": "data-connection",
      "params": {
        "connections": {
          "success": "processing-agent"
        }
      }
    }
  ]
}`,
}
