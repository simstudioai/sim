import { createLogger } from '@sim/logger'
import { withPiSandbox } from '@/lib/execution/remote-sandbox'
import {
  PI_SEARCH_EXTENSION_PATH,
  PI_SEARCH_EXTENSION_SOURCE,
} from '@/executor/handlers/pi/pi-search-extension'
import { PI_NPM } from '@/scripts/pi-sandbox-packages'

const logger = createLogger('PiSandboxContractCheck')
const EXPECTED_VERSION = '0.80.10'

function verifyStaticContract(): void {
  if (!PI_NPM.some((entry) => entry === `@earendil-works/pi-coding-agent@${EXPECTED_VERSION}`)) {
    throw new Error(`Pi sandbox package must pin coding-agent ${EXPECTED_VERSION}`)
  }
  for (const required of [
    "registerTool({\n    name: 'exa_search'",
    "pi.on('tool_result'",
    "pi.on('before_provider_request'",
    "pi.on('before_agent_start'",
  ]) {
    if (!PI_SEARCH_EXTENSION_SOURCE.includes(required)) {
      throw new Error(`Pi search extension is missing required contract: ${required}`)
    }
  }
}

async function verifyRemoteContract(): Promise<void> {
  const brokerBaseUrl = process.env.PI_EXA_BROKER_BASE_URL
  const capability = process.env.PI_SEARCH_SMOKE_CAPABILITY
  if (!brokerBaseUrl || !capability) {
    throw new Error(
      '--remote requires PI_EXA_BROKER_BASE_URL and a short-lived PI_SEARCH_SMOKE_CAPABILITY'
    )
  }
  await withPiSandbox(async (runner) => {
    await runner.writeFile(PI_SEARCH_EXTENSION_PATH, PI_SEARCH_EXTENSION_SOURCE)
    const result = await runner.run(
      `printf 'Pi search extension smoke' | pi -p --mode json --no-session --no-extensions --no-approve --no-context-files --no-skills --no-prompt-templates --tools read,bash,edit,write,grep,find,ls,exa_search -e ${PI_SEARCH_EXTENSION_PATH} --provider __smoke_invalid_provider__ --model __smoke_invalid_model__`,
      {
        envs: {
          PI_SEARCH_CAPABILITY: capability,
          PI_SEARCH_MODEL_SECRET: 'contract-check-model-key',
          PI_SEARCH_BROKER_BASE_URL: brokerBaseUrl,
          PI_SEARCH_GITHUB_FINGERPRINTS: '[]',
        },
        timeoutMs: 60_000,
        maxCombinedBytes: 1024 * 1024,
      }
    )
    if (`${result.stdout}\n${result.stderr}`.includes('Failed to load extension')) {
      throw new Error(`Remote Pi extension load failed: ${result.stderr || result.stdout}`)
    }
    const reachability = await runner.run(
      `node -e 'fetch(process.env.BROKER + "/api/internal/pi/exa-search", { method: "POST", headers: { authorization: "Bearer " + process.env.CAPABILITY, "content-type": "application/json" }, body: JSON.stringify({ query: "Pi search deployment smoke", numResults: 1 }), redirect: "error" }).then(async response => { if (!response.ok) throw new Error(response.status + ":" + await response.text()); const body = await response.json(); if (!Array.isArray(body.results)) throw new Error("invalid response") })'`,
      {
        envs: { BROKER: brokerBaseUrl, CAPABILITY: capability },
        timeoutMs: 60_000,
        maxCombinedBytes: 128 * 1024,
      }
    )
    if (reachability.exitCode !== 0) {
      throw new Error(
        `Remote Pi broker smoke failed: ${reachability.stderr || reachability.stdout}`
      )
    }
  })
}

verifyStaticContract()
if (process.argv.includes('--remote')) {
  await verifyRemoteContract()
}
logger.info('Pi sandbox contract verified', {
  version: EXPECTED_VERSION,
  remote: process.argv.includes('--remote'),
})
