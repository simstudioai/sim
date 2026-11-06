import { createServer } from 'node:http'

/**
 * Stands in for a Platform zone whose process is up and whose every page fails, as a bad deploy or an
 * unhealthy target behind a load balancer does: the main app can reach it and gets a 503 for all of
 * it. Only `/health` answers, for the job to know it has started.
 */
const port = Number(process.argv[2])
if (!port) throw new Error('usage: failing-zone.ts <port>')

createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 503)
  response.end()
}).listen(port, '127.0.0.1')
