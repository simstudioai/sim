import { readFileSync } from 'node:fs'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import {
  FUNCTION_NODE_MAJOR,
  FUNCTION_NPM_CLI_PACKAGE_CONTRACT,
  FUNCTION_PIP_CLI_PACKAGE_CONTRACT,
  FUNCTION_PYTHON_MAJOR,
  FUNCTION_PYTHON_MINOR,
  FUNCTION_SANDBOX_PARITY_CONTRACT,
} from '@/scripts/function-sandbox-packages'

const MANIFEST_SCHEMA_VERSION = 1
const EXACT_RUNTIME_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SAFE_PYTHON_PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+!-]*$/

interface VersionedPythonPackage {
  distribution: string
  importName: string
  version: string
}

interface VersionedCliPackage {
  package: string
  version: string
}

export interface FunctionSandboxParityManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  runtime: {
    node: string
    python: string
  }
  pythonPackages: VersionedPythonPackage[]
  pipCliPackages: VersionedCliPackage[]
  npmCliPackages: VersionedCliPackage[]
  commands: string[]
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecordLike(value)) throw new Error(`${field} must be an object`)
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function requireExactRuntimeVersion(value: unknown, field: string): string {
  const version = requireString(value, field)
  if (!EXACT_RUNTIME_VERSION.test(version)) {
    throw new Error(`${field} must be an exact runtime version`)
  }
  return version
}

function requireSafePythonPackageVersion(value: unknown, field: string): string {
  const version = requireString(value, field)
  if (version.length > 128 || !SAFE_PYTHON_PACKAGE_VERSION.test(version)) {
    throw new Error(`${field} is not a safe exact Python package version`)
  }
  return version
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function parseVersionedPythonPackages(value: unknown): VersionedPythonPackage[] {
  const packages = requireArray(value, 'pythonPackages')
  const expected = FUNCTION_SANDBOX_PARITY_CONTRACT.pythonPackages
  if (packages.length !== expected.length) {
    throw new Error(`pythonPackages must contain exactly ${expected.length} entries`)
  }

  return packages.map((entry, index) => {
    const item = requireRecord(entry, `pythonPackages[${index}]`)
    const expectedItem = expected[index]
    const distribution = requireString(item.distribution, `pythonPackages[${index}].distribution`)
    const importName = requireString(item.importName, `pythonPackages[${index}].importName`)
    if (distribution !== expectedItem.distribution || importName !== expectedItem.importName) {
      throw new Error(
        `pythonPackages[${index}] must be ${expectedItem.distribution}/${expectedItem.importName}`
      )
    }
    return {
      distribution,
      importName,
      version: requireSafePythonPackageVersion(item.version, `pythonPackages[${index}].version`),
    }
  })
}

function parseCliPackages(
  value: unknown,
  field: 'pipCliPackages' | 'npmCliPackages',
  expected: readonly VersionedCliPackage[]
): VersionedCliPackage[] {
  const packages = requireArray(value, field)
  if (packages.length !== expected.length) {
    throw new Error(`${field} must contain exactly ${expected.length} entries`)
  }

  return packages.map((entry, index) => {
    const item = requireRecord(entry, `${field}[${index}]`)
    const packageName = requireString(item.package, `${field}[${index}].package`)
    const version = requireString(item.version, `${field}[${index}].version`)
    const expectedItem = expected[index]
    if (packageName !== expectedItem.package || version !== expectedItem.version) {
      throw new Error(`${field}[${index}] must be ${expectedItem.package}@${expectedItem.version}`)
    }
    return { package: packageName, version }
  })
}

function parseCommands(value: unknown): string[] {
  const commands = requireArray(value, 'commands').map((command, index) =>
    requireString(command, `commands[${index}]`)
  )
  const expected = FUNCTION_SANDBOX_PARITY_CONTRACT.commands
  if (
    commands.length !== expected.length ||
    commands.some((command, index) => command !== expected[index])
  ) {
    throw new Error('commands must exactly match the Function sandbox command contract')
  }
  return commands
}

export function parseFunctionSandboxParityManifest(value: unknown): FunctionSandboxParityManifest {
  const manifest = requireRecord(value, 'manifest')
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`)
  }

  const runtime = requireRecord(manifest.runtime, 'runtime')
  const node = requireExactRuntimeVersion(runtime.node, 'runtime.node')
  const python = requireExactRuntimeVersion(runtime.python, 'runtime.python')
  if (Number(node.split('.')[0]) !== FUNCTION_NODE_MAJOR) {
    throw new Error(`runtime.node must use Node ${FUNCTION_NODE_MAJOR}`)
  }
  if (!python.startsWith(`${FUNCTION_PYTHON_MAJOR}.${FUNCTION_PYTHON_MINOR}.`)) {
    throw new Error(
      `runtime.python must use Python ${FUNCTION_PYTHON_MAJOR}.${FUNCTION_PYTHON_MINOR}`
    )
  }

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    runtime: { node, python },
    pythonPackages: parseVersionedPythonPackages(manifest.pythonPackages),
    pipCliPackages: parseCliPackages(
      manifest.pipCliPackages,
      'pipCliPackages',
      FUNCTION_PIP_CLI_PACKAGE_CONTRACT
    ),
    npmCliPackages: parseCliPackages(
      manifest.npmCliPackages,
      'npmCliPackages',
      FUNCTION_NPM_CLI_PACKAGE_CONTRACT
    ),
    commands: parseCommands(manifest.commands),
  }
}

export function readFunctionSandboxParityManifest(path: string): FunctionSandboxParityManifest {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to read Function sandbox parity manifest at ${path}: ${getErrorMessage(error)}`
    )
  }
  return parseFunctionSandboxParityManifest(value)
}

export function serializeFunctionSandboxParityManifest(
  manifest: FunctionSandboxParityManifest
): string {
  return `${JSON.stringify(parseFunctionSandboxParityManifest(manifest), null, 2)}\n`
}

export function assertFunctionSandboxParityMatches(
  expected: FunctionSandboxParityManifest,
  actual: FunctionSandboxParityManifest
): void {
  const expectedManifest = parseFunctionSandboxParityManifest(expected)
  const actualManifest = parseFunctionSandboxParityManifest(actual)
  if (JSON.stringify(expectedManifest) === JSON.stringify(actualManifest)) return

  const differences: string[] = []
  if (expectedManifest.runtime.node !== actualManifest.runtime.node) {
    differences.push(
      `Node ${actualManifest.runtime.node} (expected ${expectedManifest.runtime.node})`
    )
  }
  if (expectedManifest.runtime.python !== actualManifest.runtime.python) {
    differences.push(
      `Python ${actualManifest.runtime.python} (expected ${expectedManifest.runtime.python})`
    )
  }
  expectedManifest.pythonPackages.forEach((expectedPackage, index) => {
    const actualPackage = actualManifest.pythonPackages[index]
    if (expectedPackage.version !== actualPackage.version) {
      differences.push(
        `${expectedPackage.distribution} ${actualPackage.version} (expected ${expectedPackage.version})`
      )
    }
  })
  expectedManifest.pipCliPackages.forEach((expectedPackage, index) => {
    const actualPackage = actualManifest.pipCliPackages[index]
    if (expectedPackage.version !== actualPackage.version) {
      differences.push(
        `${expectedPackage.package} ${actualPackage.version} (expected ${expectedPackage.version})`
      )
    }
  })
  expectedManifest.npmCliPackages.forEach((expectedPackage, index) => {
    const actualPackage = actualManifest.npmCliPackages[index]
    if (expectedPackage.version !== actualPackage.version) {
      differences.push(
        `${expectedPackage.package} ${actualPackage.version} (expected ${expectedPackage.version})`
      )
    }
  })

  throw new Error(`Function sandbox parity mismatch: ${differences.join('; ')}`)
}

export function getPinnedFunctionPythonPackages(manifest: FunctionSandboxParityManifest): string[] {
  const parsed = parseFunctionSandboxParityManifest(manifest)
  return parsed.pythonPackages.map(({ distribution, version }) => `${distribution}==${version}`)
}

export function createFunctionPythonVersionsAssert(
  manifest: FunctionSandboxParityManifest
): string {
  const packages = parseFunctionSandboxParityManifest(manifest).pythonPackages.map(
    ({ distribution, version }) => ({ distribution, version })
  )
  return `python3 -c 'import importlib.metadata as metadata; packages = ${JSON.stringify(packages)}; assert all(metadata.version(item["distribution"]) == item["version"] for item in packages)'`
}

export function createFunctionSandboxParityProbe(resultPrefix: string): string {
  const contractJson = JSON.stringify(FUNCTION_SANDBOX_PARITY_CONTRACT)
  return `set -euo pipefail
python3 - <<'PY'
import importlib
import importlib.metadata as metadata
import json
import os
import platform
import shutil
import subprocess
import sys

contract = ${contractJson}

if list(sys.version_info[:2]) != [${FUNCTION_PYTHON_MAJOR}, ${FUNCTION_PYTHON_MINOR}]:
    raise RuntimeError(f"unexpected Python runtime: {platform.python_version()}")

node_version = subprocess.check_output(
    ["node", "-p", "process.versions.node"], text=True
).strip()
if int(node_version.split(".")[0]) != ${FUNCTION_NODE_MAJOR}:
    raise RuntimeError(f"unexpected Node runtime: {node_version}")

python_packages = []
for item in contract["pythonPackages"]:
    version = metadata.version(item["distribution"])
    importlib.import_module(item["importName"])
    python_packages.append({**item, "version": version})

pip_cli_packages = []
for item in contract["pipCliPackages"]:
    actual_version = metadata.version(item["package"])
    if actual_version != item["version"]:
        raise RuntimeError(
            f'unexpected {item["package"]} version: {actual_version}'
        )
    pip_cli_packages.append({"package": item["package"], "version": actual_version})

npm_root = subprocess.check_output(["npm", "root", "--global"], text=True).strip()
npm_cli_packages = []
for item in contract["npmCliPackages"]:
    with open(
        os.path.join(npm_root, item["package"], "package.json"),
        encoding="utf-8",
    ) as package_file:
        actual_version = json.load(package_file)["version"]
    if actual_version != item["version"]:
        raise RuntimeError(
            f'unexpected {item["package"]} version: {actual_version}'
        )
    npm_cli_packages.append({"package": item["package"], "version": actual_version})

missing_commands = [
    command for command in contract["commands"] if shutil.which(command) is None
]
if missing_commands:
    raise RuntimeError(f"missing commands: {', '.join(missing_commands)}")

manifest = {
    "schemaVersion": ${MANIFEST_SCHEMA_VERSION},
    "runtime": {
        "node": node_version,
        "python": platform.python_version(),
    },
    "pythonPackages": python_packages,
    "pipCliPackages": pip_cli_packages,
    "npmCliPackages": npm_cli_packages,
    "commands": contract["commands"],
}
print(${JSON.stringify(resultPrefix)} + json.dumps(manifest, separators=(",", ":")))
PY`
}
