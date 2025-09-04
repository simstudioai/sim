#!/usr/bin/env node

/**
 * Simple MCP Test Server
 * Implements basic HTTP transport with a single "echo" tool
 * Run with: node test-mcp-server.js
 */

const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const requestId = 0

// MCP Protocol handler
app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body

  console.log(`[MCP] Received request: ${method}`, { id, params })

  // Handle different MCP methods
  switch (method) {
    case 'initialize':
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: 'test-mcp-server',
            version: '1.0.0',
          },
        },
      })
      break

    case 'notifications/initialized':
      // Notification - no response needed
      res.status(204).send()
      break

    case 'tools/list':
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo back the input message',
              inputSchema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    description: 'Message to echo back',
                  },
                },
                required: ['message'],
              },
            },
            {
              name: 'time',
              description: 'Get current server time',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      })
      break

    case 'tools/call': {
      const { name, arguments: args } = params

      if (name === 'echo') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Echo: ${args.message || 'No message provided'}`,
              },
            ],
          },
        })
      } else if (name === 'time') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Current server time: ${new Date().toISOString()}`,
              },
            ],
          },
        })
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unknown tool: ${name}`,
          },
        })
      }
      break
    }

    default:
      res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

// Root endpoint info
app.get('/', (req, res) => {
  res.json({
    name: 'Simple MCP Test Server',
    version: '1.0.0',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
    },
    transport: 'http',
  })
})

const PORT = process.env.PORT || 4040

app.listen(PORT, () => {
  console.log(`🚀 MCP Test Server running on http://localhost:${PORT}`)
  console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`)
  console.log(`💚 Health check: http://localhost:${PORT}/health`)
})
