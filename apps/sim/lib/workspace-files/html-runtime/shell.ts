/**
 * The shell receives bytes and a single MessagePort from its trusted parent. It has no cookies,
 * bearer tokens, file identifiers or access to arbitrary application APIs. document.open preserves
 * the window's API object and the MessagePort while replacing the bootstrap document.
 */
export function htmlRuntimeShell(appOrigin: string): string {
  const origin = JSON.stringify(appOrigin).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sim document</title></head><body><script>
(() => {
  const appOrigin = ${origin};
  let initialized = false;
  const announce = () => parent.postMessage({ type: 'sim:html:ready' }, appOrigin);
  const readyTimer = setInterval(announce, 500);
  const readyDeadline = setTimeout(() => clearInterval(readyTimer), 15000);
  window.addEventListener('message', function initialize(event) {
    if (initialized || event.source !== parent || event.origin !== appOrigin || event.data?.type !== 'sim:html:init' || typeof event.data.html !== 'string' || event.ports.length !== 1) return;
    initialized = true;
    clearInterval(readyTimer);
    clearTimeout(readyDeadline);
    const port = event.ports[0];
    const pending = new Map();
    const subscribers = new Map();
    let sequence = 0;
    function request(method, workflowId, input) {
      if (typeof workflowId !== 'string') return Promise.reject(new Error('workflowId is required'));
      if (pending.size >= 8) return Promise.reject(new Error('Too many pending workflow calls'));
      return new Promise((resolve, reject) => {
        const requestId = ++sequence;
        const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('Workflow request timed out; read its status before retrying')); }, 600000);
        const notify = input !== null && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0;
        pending.set(requestId, { resolve, reject, timeout, workflowId, notify });
        port.postMessage({ type: 'sim:workflow:request', requestId, method, workflowId, input });
      });
    }
    function publish(workflowId, result) {
      for (const callback of subscribers.get(workflowId) ?? []) callback(result);
      window.dispatchEvent(new CustomEvent('sim:workflow-result', { detail: { workflowId, result } }));
    }
    port.onmessage = ({ data }) => {
      if (data?.type === 'sim:workflow:response') {
        const waiting = pending.get(data.requestId);
        if (!waiting) return;
        pending.delete(data.requestId);
        clearTimeout(waiting.timeout);
        if (data.error) waiting.reject(new Error(data.error));
        else {
          waiting.resolve(data.result);
          if (waiting.notify) publish(waiting.workflowId, data.result);
        }
      } else if (data?.type === 'sim:workflow:changed') {
        publish(data.workflowId, data.result);
      }
    };
    Object.defineProperty(window, 'sim', { value: Object.freeze({ workflows: Object.freeze({
      run: (id, input = {}) => request('run', id, input),
      read: (id, input = {}) => request('read', id, input),
      subscribe: (id, callback) => {
        if (typeof id !== 'string' || typeof callback !== 'function') throw new Error('subscribe requires a workflow ID and callback');
        const callbacks = subscribers.get(id) ?? new Set();
        callbacks.add(callback); subscribers.set(id, callbacks);
        return () => { callbacks.delete(callback); if (!callbacks.size) subscribers.delete(id); };
      }
    }) }), writable: false, configurable: false });
    port.start();
    document.open();
    document.write(event.data.html);
    document.close();
  });
  announce();
})();
</script></body></html>`
}

export function htmlRuntimeCsp(appOrigin: string): string {
  return `sandbox allow-scripts; default-src 'none'; script-src https: data: blob: 'unsafe-inline' 'unsafe-eval'; style-src https: 'unsafe-inline'; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https: wss:; frame-src https: data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${appOrigin}`
}
