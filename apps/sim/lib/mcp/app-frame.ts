import { isPlainRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

function approvedDomains(value: unknown, allowWebSocket = false): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32)
    throw new OrchestrationError('validation', 'Invalid MCP App security policy')
  return value.map((domain) => {
    if (
      typeof domain !== 'string' ||
      domain.length > 256 ||
      !/^(?:https|wss):\/\/(?:\*\.)?[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(domain)
    )
      throw new OrchestrationError('validation', 'MCP Apps require explicit HTTPS domains')
    const url = new URL(domain.replace('://*.', '://'))
    if (url.protocol === 'wss:' && !allowWebSocket)
      throw new OrchestrationError('validation', 'Static App resources require HTTPS')
    if (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      /^[\d.]+$/.test(url.hostname)
    )
      throw new OrchestrationError('validation', 'MCP Apps cannot access local network addresses')
    return domain
  })
}

/** A network document with CSP sandboxing has an opaque origin and its own CSP policy container. */
export function buildMcpAppFrame(html: string, metadata: unknown) {
  if (Buffer.byteLength(html, 'utf8') > 1024 * 1024)
    throw new OrchestrationError('payload_too_large', 'MCP App HTML exceeds 1 MiB')
  const ui = isPlainRecord(metadata) && isPlainRecord(metadata.ui) ? metadata.ui : {}
  const csp = isPlainRecord(ui.csp) ? ui.csp : {}
  const resources = approvedDomains(csp.resourceDomains).join(' ')
  const connections = approvedDomains(csp.connectDomains, true).join(' ')
  const policy = [
    'sandbox allow-scripts',
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    `script-src 'unsafe-inline' ${resources}`,
    `style-src 'unsafe-inline' ${resources}`,
    `img-src data: blob: ${resources}`,
    `media-src data: blob: ${resources}`,
    `font-src data: ${resources}`,
    `connect-src ${connections || "'none'"}`,
    'frame-src blob:',
  ].join('; ')
  const encodedHtml = Buffer.from(html).toString('base64')
  const document = `<!doctype html><html><head><meta name="referrer" content="no-referrer"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block;overflow:hidden}</style></head><body><script>
const frame = document.createElement('iframe');
frame.sandbox = 'allow-scripts';
frame.referrerPolicy = 'no-referrer';
let started = false;
let childReady = false;
const pending = [];
addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;
  if (event.source === parent) {
    if (data.method === 'ui/notifications/sandbox-resource-ready') {
      if (started) return;
      started = true;
      const bytes = Uint8Array.from(atob('${encodedHtml}'), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type:'text/html'}));
      frame.src = url;
      frame.onload = () => URL.revokeObjectURL(url);
      document.body.append(frame);
      return;
    }
    if (childReady) frame.contentWindow.postMessage(data, '*');
    else if (pending.length < 8) pending.push(data);
  } else if (event.source === frame.contentWindow) {
    if (typeof data.method === 'string' && data.method.startsWith('ui/notifications/sandbox-')) return;
    childReady = true;
    parent.postMessage(data, '*');
    for (const message of pending.splice(0)) frame.contentWindow.postMessage(message, '*');
  }
});
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}}, '*');
</script></body></html>`
  return { buffer: Buffer.from(document), contentType: 'text/html; charset=utf-8', policy }
}
