// A minimal test harness: test() registers, run() runs everything and writes a report into the
// page, ending with a line "SUMMARY: n passed, m failed" that tools/test.sh looks for.

const tests = [];

export function test(name, fn) { tests.push({ name, fn }); }

export class AssertionError extends Error {}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new AssertionError(msg);
}

export function close(actual, expected, tol, msg = '') {
  const err = Math.abs(actual - expected);
  if (!(err <= tol)) {
    throw new AssertionError(`${msg} expected ${expected}, got ${actual} (|error| ${err.toExponential(2)} > ${tol})`);
  }
}

export function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export async function run(out) {
  let passed = 0, failed = 0;
  const lines = [];
  for (const { name, fn } of tests) {
    const t0 = performance.now();
    try {
      const note = await fn();
      const ms = (performance.now() - t0).toFixed(0);
      lines.push(`ok    ${name} (${ms} ms)${note ? ' -- ' + note : ''}`);
      passed++;
    } catch (e) {
      lines.push(`FAIL  ${name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
      failed++;
    }
  }
  lines.push(`SUMMARY: ${passed} passed, ${failed} failed`);
  out.textContent = lines.join('\n');
  document.title = failed ? 'FAILED' : 'passed';
  return failed;
}
