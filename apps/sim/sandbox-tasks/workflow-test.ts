import { defineSandboxTask } from '@/lib/execution/sandbox/define-task'
import type { SandboxTaskInput } from '@/lib/execution/sandbox/types'
import { workflowTestBrokers } from '@/lib/workflow-tests/brokers'

/** Wall-clock budget for one test file: every test, workflow run, and judge call in it. */
const WORKFLOW_TEST_FILE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_TEST_TIMEOUT_MS = 5 * 60_000
const MAX_RUBRIC_RUNS = 5

/**
 * The vitest-shaped harness. User code is a test file evaluated as an ES module; its
 * `import ... from 'vitest'` and `'sim:test'` resolve to `WORKFLOW_TEST_MODULES`, which read
 * `globalThis.__simTest`. Module evaluation only registers suites and tests; `finalize`
 * runs them (or, for collection, just lists them) and returns the report as JSON bytes.
 */
const HARNESS = `
  const vx = globalThis.__bundles['vitest-expect'];
  if (!vx) throw new Error('vitest-expect bundle not loaded');
  const brokers = globalThis.__brokers;
  const call = (name, args) => brokers[name](args);

  const DEFAULT_TEST_TIMEOUT_MS = ${DEFAULT_TEST_TIMEOUT_MS};
  const MAX_RUBRIC_RUNS = ${MAX_RUBRIC_RUNS};

  const newSuite = (name, parent, mode) => ({
    name, parent, mode, children: [],
    hooks: { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] },
  });
  const root = newSuite('', null, 'run');
  let currentSuite = root;
  let collecting = true;
  let currentTest = null;
  let hasOnly = false;

  const requireCollecting = (what) => {
    if (!collecting) throw new Error(what + ' must be called at the top level of the file or inside describe()');
  };
  const requireRunning = (what) => {
    if (collecting) throw new Error(what + ' can only be called inside a test or a hook');
  };
  const requireName = (what, name) => {
    if (typeof name !== 'string' || name.trim() === '') throw new Error(what + ' needs a name');
  };

  function defineSuite(mode) {
    return function describe(name, fn) {
      requireCollecting('describe()');
      requireName('describe()', name);
      if (typeof fn !== 'function') throw new Error('describe("' + name + '") needs a callback');
      if (mode === 'only') hasOnly = true;
      const suite = newSuite(name, currentSuite, mode);
      currentSuite.children.push({ kind: 'suite', suite });
      const previous = currentSuite;
      currentSuite = suite;
      try {
        const result = fn();
        if (result && typeof result.then === 'function') {
          throw new Error('describe("' + name + '") callback must not be async; put awaits inside tests or hooks');
        }
      } finally {
        currentSuite = previous;
      }
    };
  }
  function defineTest(mode) {
    return function it(name, fn, timeoutMs) {
      requireCollecting('it()');
      requireName('it()', name);
      if (mode !== 'skip' && typeof fn !== 'function') throw new Error('it("' + name + '") needs a callback');
      if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs > 0)) {
        throw new Error('it("' + name + '") timeout must be a positive whole number of milliseconds');
      }
      if (mode === 'only') hasOnly = true;
      const site = callSite(new Error().stack);
      if (!site) throw new Error('it("' + name + '") could not be located in the file');
      const span = typeof fn === 'function' ? String(fn).split('\\n').length - 1 : 0;
      currentSuite.children.push({ kind: 'test', test: { name, fn, mode, timeoutMs: timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS, line: site.line, endLine: site.line + span } });
    };
  }
  const describe = defineSuite('run');
  describe.only = defineSuite('only');
  describe.skip = defineSuite('skip');
  const it = defineTest('run');
  it.only = defineTest('only');
  it.skip = defineTest('skip');
  const hook = (kind) => (fn) => {
    requireCollecting(kind + '()');
    if (typeof fn !== 'function') throw new Error(kind + '() needs a callback');
    currentSuite.hooks[kind].push(fn);
  };

  function callSite(stack) {
    for (const line of String(stack || '').split('\\n').slice(1)) {
      const match = /\\(?([^\\s()]+):(\\d+):(\\d+)\\)?\\s*$/.exec(line.trim());
      if (match && !match[1].startsWith('sandbox/')) return { line: Number(match[2]), column: Number(match[3]) };
    }
    return null;
  }
  function describeError(error) {
    const info = { message: error && error.message ? String(error.message) : String(error) };
    if (error && error.showDiff !== false && error && 'expected' in error && 'actual' in error) {
      for (const key of ['actual', 'expected']) {
        try {
          JSON.stringify(error[key]);
          info[key] = error[key];
        } catch {}
      }
    }
    return info;
  }

  const baseExpect = vx.createExpect();
  function settle(check, status, error) {
    if (check.status !== 'pending') return;
    check.status = status;
    if (error) Object.assign(check, describeError(error));
  }
  function track(assertion, check, test) {
    return new Proxy(assertion, {
      get(target, key) {
        let value;
        try {
          value = Reflect.get(target, key, target);
        } catch (error) {
          settle(check, 'fail', error);
          throw error;
        }
        if (typeof value === 'function') {
          return (...args) => {
            let result;
            try {
              result = value.apply(target, args);
            } catch (error) {
              settle(check, 'fail', error);
              throw error;
            }
            if (result && typeof result.then === 'function') {
              const settled = result.then(
                (resolved) => { settle(check, 'pass'); return resolved; },
                (error) => { settle(check, 'fail', error); throw error; }
              );
              test.pendingAssertions.push(settled.catch(() => {}));
              return settled;
            }
            settle(check, 'pass');
            return result && typeof result === 'object' && result.__flags ? track(result, check, test) : result;
          };
        }
        if (value && typeof value === 'object' && value.__flags) return track(value, check, test);
        return value;
      },
    });
  }
  const expect = (value, message) => {
    const assertion = baseExpect(value, message);
    if (!currentTest) return assertion;
    const check = { status: 'pending', ...(callSite(new Error().stack) || {}) };
    currentTest.checks.push(check);
    currentTest.activeCheck = check;
    return track(assertion, check, currentTest);
  };
  Object.setPrototypeOf(expect, baseExpect);
  expect.assertions = (count) => {
    if (!currentTest) throw new Error('expect.assertions() can only be called inside a test');
    if (!Number.isInteger(count) || count < 0) throw new Error('expect.assertions() needs a whole number');
    currentTest.expectedAssertions = count;
  };
  expect.hasAssertions = () => {
    if (!currentTest) throw new Error('expect.hasAssertions() can only be called inside a test');
    currentTest.expectsAssertions = true;
  };
  function checkAssertionCount(test) {
    const made = test.checks.length;
    if (test.expectedAssertions !== null && made !== test.expectedAssertions) {
      throw new Error('Expected ' + test.expectedAssertions + ' assertions to be called but received ' + made);
    }
    if (test.expectsAssertions && made === 0) throw new Error('Expected at least one assertion to be called but received none');
  }

  baseExpect.extend({
    async toMatchRubric(received, rubric, options) {
      if (typeof rubric !== 'string' || rubric.trim() === '') throw new Error('toMatchRubric() needs a rubric string');
      const runs = options && options.runs !== undefined ? options.runs : 1;
      if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUBRIC_RUNS) {
        throw new Error('toMatchRubric() runs must be a whole number from 1 to ' + MAX_RUBRIC_RUNS);
      }
      const value = typeof received === 'string' ? received : JSON.stringify(received, null, 2);
      if (value === undefined) throw new Error('toMatchRubric() received undefined');
      const check = currentTest && currentTest.activeCheck;
      let verdict = { pass: true, reason: '' };
      for (let i = 0; i < runs && verdict.pass; i++) {
        verdict = await call('testJudge', { value, rubric });
      }
      if (check) check.judge = verdict.reason;
      return {
        pass: verdict.pass,
        message: () => verdict.pass ? 'Expected the output not to satisfy: ' + rubric + '. ' + verdict.reason : verdict.reason,
      };
    },
  });

  const vi = { fn: vx.fn, spyOn: vx.spyOn, isMockFunction: vx.isMockFunction };

  const registrations = new Map();
  const registrationKey = (kind, workflow, block, tool) => kind + '\\u0000' + (workflow ?? '') + '\\u0000' + (block ?? '') + '\\u0000' + (tool ?? '');
  const describeRegistration = (r) => r.kind === 'tool'
    ? 'mockTool("' + (r.block ? r.block + '", "' : '') + r.tool + '")'
    : (r.kind === 'mock' ? 'mockBlock' : 'spyOnBlock') + '("' + (r.workflow ? r.workflow + '", "' : '') + r.block + '")';
  function addRegistration(entry) {
    const key = registrationKey(entry.kind, entry.workflow, entry.block, entry.tool);
    const existing = registrations.get(key);
    if (existing) return existing.fn;
    const fn = vx.fn().mockName(entry.label);
    const registration = { ...entry, key, fn, test: currentTest, sample: undefined };
    if (entry.kind !== 'spy') {
      fn.mockSampleOutput = (overrides) => {
        if (overrides !== undefined && (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))) {
          throw new Error(describeRegistration(registration) + '.mockSampleOutput() takes an object of fields to override');
        }
        registration.sample = overrides ?? {};
        return fn;
      };
    }
    registrations.set(key, registration);
    return fn;
  }
  function register(kind, first, second) {
    const workflow = second === undefined ? null : first;
    const block = second === undefined ? first : second;
    const what = kind === 'mock' ? 'mockBlock()' : 'spyOnBlock()';
    requireName(what, block);
    if (workflow !== null) requireName(what + ' workflow', workflow);
    return addRegistration({ kind, workflow, block, tool: null, label: workflow ? workflow + ' / ' + block : block });
  }
  const mockBlock = (first, second) => register('mock', first, second);
  const spyOnBlock = (first, second) => register('spy', first, second);
  const mockTool = (first, second) => {
    const block = second === undefined ? null : first;
    const tool = second === undefined ? first : second;
    requireName('mockTool()', tool);
    if (block !== null) requireName('mockTool() Agent block', block);
    return addRegistration({ kind: 'tool', workflow: null, block, tool, label: block ? block + ' / ' + tool : tool });
  };

  /** Overrides on a generated sample: objects merge, anything else replaces, and an unknown field is a mistake. */
  function mergeSample(sample, overrides, path) {
    const merged = { ...sample };
    for (const [field, value] of Object.entries(overrides)) {
      const at = path ? path + '.' + field : field;
      if (!(field in sample)) {
        throw new Error('mockSampleOutput(): the output has no field "' + at + '". It has: ' + (Object.keys(sample).join(', ') || 'no fields'));
      }
      const base = sample[field];
      merged[field] = base && typeof base === 'object' && !Array.isArray(base) && value && typeof value === 'object' && !Array.isArray(value)
        ? mergeSample(base, value, at)
        : value;
    }
    return merged;
  }

  class WorkflowRunError extends Error {
    constructor(message, executionId, output) {
      super(message);
      this.name = 'WorkflowRunError';
      this.executionId = executionId;
      this.output = output;
    }
  }

  async function answerMock(event) {
    const entry = registrations.get(event.key);
    if (!entry) return { error: 'No mock is registered for ' + (event.tool ?? event.block) };
    try {
      if (entry.sample !== undefined) {
        let output;
        try {
          output = mergeSample(event.sample, entry.sample, '');
        } catch (error) {
          return { error: String(error.message), mistake: describeRegistration(entry) + ': ' + String(error.message) };
        }
        await entry.fn(event.input);
        return { output };
      }
      const output = await entry.fn(event.input);
      if (output === undefined) {
        return { error: describeRegistration(entry) + ' returned nothing. Give it a value with .mockResolvedValue(...) or .mockSampleOutput()' };
      }
      return { output };
    } catch (error) {
      return { error: error && error.message ? String(error.message) : String(error) };
    }
  }

  async function runWorkflow(workflow, input, options) {
    requireRunning('runWorkflow()');
    if (!currentTest) throw new Error('runWorkflow() runs only inside a test, beforeEach, or afterEach; beforeAll and afterAll have no test to record it on');
    requireName('runWorkflow()', workflow);
    if (options !== undefined) {
      const extra = options === null || typeof options !== 'object' ? ['options'] : Object.keys(options).filter((key) => key !== 'trigger');
      if (extra.length > 0) throw new Error('runWorkflow() options take only { trigger: "Trigger block name" }; pick draft or deployed when you run the tests');
      requireName('runWorkflow() trigger', options.trigger);
    }
    const trigger = options ? options.trigger : null;
    const targets = [...registrations.values()].map((r) => r.kind === 'tool'
      ? { key: r.key, kind: 'tool', workflow: null, block: r.block, tool: r.tool }
      : { key: r.key, kind: r.kind, workflow: r.workflow, block: r.block });
    const test = currentTest;
    const mistakes = [];
    let event = await call('testStart', { workflow, trigger, input: input === undefined ? null : input, targets });
    test.runIds.push(event.runId);
    while (event.kind !== 'done') {
      if (event.kind === 'mock') {
        const { mistake, ...reply } = await answerMock(event);
        if (mistake) mistakes.push(mistake);
        event = await call('testReply', { runId: event.runId, callId: event.callId, ...reply });
      } else {
        event = await call('testNext', { runId: event.runId });
      }
    }
    test.executions.push({ workflow, executionId: event.executionId });
    for (const key of event.matchedKeys) test.matchedKeys.add(key);
    for (const spyCall of event.spyCalls) {
      const entry = registrations.get(spyCall.key);
      if (!entry) continue;
      entry.fn.mockImplementationOnce(() => spyCall.output);
      entry.fn(spyCall.input);
    }
    if (mistakes.length > 0) throw new Error(mistakes.join('\\n'));
    if (event.error) throw new WorkflowRunError(event.error, event.executionId, event.output);
    return { output: event.output, executionId: event.executionId };
  }

  const logLines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level];
    console[level] = (...args) => {
      if (currentTest) {
        currentTest.logs.push(args.map((a) => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' '));
      }
      return original.apply(console, args);
    };
  }

  /** A timed-out case keeps running in the isolate, so every later case is reported unrun. */
  let timedOutTest = null;
  function withTimeout(promise, ms, label, onTimeout) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(label + ' timed out after ' + ms + 'ms'));
        }, ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  const suitePath = (suite) => {
    const names = [];
    for (let s = suite; s && s.parent; s = s.parent) names.unshift(s.name);
    return names;
  };
  const suiteChain = (suite) => {
    const chain = [];
    for (let s = suite; s; s = s.parent) chain.unshift(s);
    return chain;
  };
  function listTests(suite, out) {
    for (const child of suite.children) {
      if (child.kind === 'suite') listTests(child.suite, out);
      else out.push({ suite, test: child.test, path: [...suitePath(suite), child.test.name] });
    }
    return out;
  }

  async function runHooks(fns) {
    for (const fn of fns) await fn();
  }

  function willRun(suite, test, onlyNames) {
    const chain = suiteChain(suite);
    if (test.mode === 'skip' || chain.some((s) => s.mode === 'skip')) return false;
    if (hasOnly && test.mode !== 'only' && !chain.some((s) => s.mode === 'only')) return false;
    return !onlyNames || onlyNames.includes([...suitePath(suite), test.name].join(' > '));
  }

  async function runOne(suite, test, onlyNames) {
    const path = [...suitePath(suite), test.name];
    const result = { path, status: 'pass', durationMs: 0, checks: [], executions: [], logs: [], runIds: [], matchedKeys: new Set(), activeCheck: null, expectedAssertions: null, expectsAssertions: false, pendingAssertions: [] };
    if (!willRun(suite, test, onlyNames)) {
      result.status = 'skip';
      return result;
    }
    if (timedOutTest) {
      result.status = 'fail';
      result.error = { name: 'Error', message: 'Not run: "' + timedOutTest + '" timed out and may still be running' };
      await call('testProgress', { path, status: result.status });
      return result;
    }
    await call('testProgress', { path, status: 'running' });
    const startedAt = Date.now();
    currentTest = result;
    try {
      await withTimeout((async () => {
        for (const s of suiteChain(suite)) await runHooks(s.hooks.beforeEach);
        try {
          await test.fn();
        } finally {
          for (const s of suiteChain(suite).reverse()) await runHooks(s.hooks.afterEach);
        }
        await Promise.all(result.pendingAssertions);
        if (result.checks.some((check) => check.status === 'fail')) {
          throw new Error('An assertion failed after its test returned; await expect(...).resolves, .rejects, and toMatchRubric');
        }
        checkAssertionCount(result);
        const unmatched = [...registrations.values()].filter((r) => r.test === result && result.runIds.length > 0 && !result.matchedKeys.has(r.key));
        if (unmatched.length > 0) {
          const names = unmatched.map(describeRegistration);
          throw new Error(names.join(', ') + ' matched no block in the workflows this test ran');
        }
      })(), test.timeoutMs, 'Test', () => { timedOutTest = path.join(' > '); });
    } catch (error) {
      result.status = 'fail';
      const owned = result.checks.find((check) => check.status === 'fail');
      if (!owned) result.error = { ...describeError(error), ...(callSite(error && error.stack) || {}) };
    } finally {
      for (const check of result.checks) if (check.status === 'pending') check.status = 'skip';
      for (const [key, registration] of registrations) if (registration.test === result) registrations.delete(key);
      currentTest = null;
      if (result.runIds.length) await call('testCancel', { runIds: result.runIds });
      result.durationMs = Date.now() - startedAt;
    }
    await call('testProgress', { path, status: result.status });
    return result;
  }

  async function runSuiteTree(suite, onlyNames, out) {
    const anyRuns = listTests(suite, []).some((entry) => willRun(entry.suite, entry.test, onlyNames));
    if (anyRuns) await runHooks(suite.hooks.beforeAll);
    try {
      for (const child of suite.children) {
        if (child.kind === 'suite') await runSuiteTree(child.suite, onlyNames, out);
        else out.push(await runOne(suite, child.test, onlyNames));
      }
    } finally {
      if (anyRuns) await runHooks(suite.hooks.afterAll);
    }
  }

  globalThis.__simTest = {
    modules: {
      vitest: { describe, it, test: it, expect, vi, beforeAll: hook('beforeAll'), afterAll: hook('afterAll'), beforeEach: hook('beforeEach'), afterEach: hook('afterEach') },
      sim: { runWorkflow, mockBlock, spyOnBlock, mockTool },
    },
    collect() {
      collecting = false;
      return {
        topLevel: root.children.map((c) => c.kind === 'suite' ? { kind: 'suite', name: c.suite.name } : { kind: 'test', name: c.test.name }),
        tests: listTests(root, []).map((e) => ({ path: e.path, mode: e.test.mode, line: e.test.line, endLine: e.test.endLine })),
      };
    },
    async run() {
      const plan = this.collect();
      const { only } = await call('testPlan', {});
      const results = [];
      await runSuiteTree(root, only, results);
      return {
        topLevel: plan.topLevel,
        tests: results.map(({ path, status, durationMs, checks, executions, logs, error }) => ({ path, status, durationMs, checks, executions, logs, ...(error ? { error } : {}) })),
      };
    },
  };
`

const VITEST_MODULE = `
const m = globalThis.__simTest.modules.vitest;
export const { describe, it, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } = m;
`

const SIM_TEST_MODULE = `
const m = globalThis.__simTest.modules.sim;
export const { runWorkflow, mockBlock, spyOnBlock, mockTool } = m;
`

const WORKFLOW_TEST_MODULES = { vitest: VITEST_MODULE, 'sim:test': SIM_TEST_MODULE }

const encodeReport = (expression: string) =>
  `return new TextEncoder().encode(JSON.stringify(${expression}));`

/** Runs every test in a file (or only `testPlan().only`) and returns the report. */
export const workflowTestRunTask = defineSandboxTask<SandboxTaskInput>({
  id: 'workflow-test-run',
  timeoutMs: WORKFLOW_TEST_FILE_TIMEOUT_MS,
  bundles: ['vitest-expect'],
  brokers: workflowTestBrokers,
  bootstrap: HARNESS,
  userModules: WORKFLOW_TEST_MODULES,
  finalize: encodeReport('await globalThis.__simTest.run()'),
  toResult: (bytes) => Buffer.from(bytes),
})

/** Evaluates a test file without running anything and lists its suites and tests. */
export const workflowTestCollectTask = defineSandboxTask<SandboxTaskInput>({
  id: 'workflow-test-collect',
  timeoutMs: 10_000,
  bundles: ['vitest-expect'],
  brokers: [],
  bootstrap: HARNESS,
  userModules: WORKFLOW_TEST_MODULES,
  finalize: encodeReport('globalThis.__simTest.collect()'),
  toResult: (bytes) => Buffer.from(bytes),
})
