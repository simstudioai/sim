import { safeJsonForScript } from './preview-security'

export function buildPreviewHandshakeScript(params: {
  channelNonce: string
  parentOrigin: string
}): string {
  const config = safeJsonForScript(params)
  const ready = safeJsonForScript({
    type: 'sim.preview.ready',
    nonce: params.channelNonce,
  })
  return `(function(){var cfg=${config};window.__SIM_PREVIEW__=cfg;function announceReady(){window.parent.postMessage(${ready},cfg.parentOrigin);}window.addEventListener('message',function(event){if(event.origin!==cfg.parentOrigin||event.source!==window.parent)return;var data=event.data;if(data&&data.type==='sim.preview.ping'&&data.nonce===cfg.channelNonce)announceReady();});announceReady();})();`
}
