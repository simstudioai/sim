/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS,
  FUNCTION_NPM_CLI_PACKAGE_CONTRACT,
  FUNCTION_PIP_CLI_PACKAGE_CONTRACT,
  FUNCTION_REQUIRED_COMMANDS,
} from '@/scripts/function-sandbox-packages'
import {
  assertFunctionSandboxParityMatches,
  createFunctionPythonVersionsAssert,
  createFunctionSandboxParityProbe,
  type FunctionSandboxParityManifest,
  getPinnedFunctionPythonPackages,
  parseFunctionSandboxParityManifest,
  serializeFunctionSandboxParityManifest,
} from '@/scripts/function-sandbox-parity-manifest'

function createManifest(): FunctionSandboxParityManifest {
  return {
    schemaVersion: 1,
    runtime: { node: '20.20.2', python: '3.13.14' },
    pythonPackages: FUNCTION_BASE_PYTHON_PACKAGE_IMPORTS.map((item, index) => ({
      ...item,
      version: `${index + 1}.0.0`,
    })),
    pipCliPackages: FUNCTION_PIP_CLI_PACKAGE_CONTRACT.map((item) => ({ ...item })),
    npmCliPackages: FUNCTION_NPM_CLI_PACKAGE_CONTRACT.map((item) => ({ ...item })),
    commands: [...FUNCTION_REQUIRED_COMMANDS],
  }
}

describe('Function sandbox parity manifest', () => {
  it('parses the complete exact provider surface', () => {
    const manifest = createManifest()
    expect(parseFunctionSandboxParityManifest(manifest)).toEqual(manifest)
    expect(JSON.parse(serializeFunctionSandboxParityManifest(manifest))).toEqual(manifest)
  })

  it('rejects missing, reordered, and unsafe package values', () => {
    const missing = createManifest()
    missing.pythonPackages.pop()
    expect(() => parseFunctionSandboxParityManifest(missing)).toThrow(
      'pythonPackages must contain exactly'
    )

    const reordered = createManifest()
    ;[reordered.pythonPackages[0], reordered.pythonPackages[1]] = [
      reordered.pythonPackages[1],
      reordered.pythonPackages[0],
    ]
    expect(() => parseFunctionSandboxParityManifest(reordered)).toThrow('pythonPackages[0] must be')

    const unsafe = createManifest()
    unsafe.pythonPackages[0].version = '1.0.0; touch /tmp/pwned'
    expect(() => parseFunctionSandboxParityManifest(unsafe)).toThrow(
      'is not a safe exact Python package version'
    )
  })

  it('rejects runtime and pinned CLI drift', () => {
    const wrongNode = createManifest()
    wrongNode.runtime.node = '22.1.0'
    expect(() => parseFunctionSandboxParityManifest(wrongNode)).toThrow(
      'runtime.node must use Node 20'
    )

    const wrongPython = createManifest()
    wrongPython.runtime.python = '3.12.9'
    expect(() => parseFunctionSandboxParityManifest(wrongPython)).toThrow(
      'runtime.python must use Python 3.13'
    )

    const wrongCli = createManifest()
    wrongCli.pipCliPackages[0].version = '999.0.0'
    expect(() => parseFunctionSandboxParityManifest(wrongCli)).toThrow(
      'pipCliPackages[0] must be yq@4.1.2'
    )
  })

  it('reports exact provider differences', () => {
    const expected = createManifest()
    const actual = createManifest()
    actual.runtime.node = '20.19.0'
    actual.pythonPackages[0].version = '999.0.0'

    expect(() => assertFunctionSandboxParityMatches(expected, actual)).toThrow(
      'Node 20.19.0 (expected 20.20.2); numpy 999.0.0 (expected 1.0.0)'
    )
  })

  it('builds exact Daytona Python requirements from the accepted baseline', () => {
    const manifest = createManifest()
    expect(getPinnedFunctionPythonPackages(manifest)).toHaveLength(49)
    expect(getPinnedFunctionPythonPackages(manifest)[0]).toBe('numpy==1.0.0')
    expect(createFunctionPythonVersionsAssert(manifest)).toContain(
      'metadata.version(item["distribution"]) == item["version"]'
    )
    expect(createFunctionPythonVersionsAssert(manifest)).toContain(
      '"distribution":"numpy","version":"1.0.0"'
    )
  })

  it('generates a probe that captures actual versions instead of echoing its contract', () => {
    const probe = createFunctionSandboxParityProbe('__SIM_RESULT__=')
    expect(probe).toContain('platform.python_version()')
    expect(probe).toContain('["node", "-p", "process.versions.node"]')
    expect(probe).toContain('version = metadata.version(item["distribution"])')
    expect(probe).toContain('"pythonPackages": python_packages')
    expect(probe).not.toContain('json.dumps(contract')
  })
})
