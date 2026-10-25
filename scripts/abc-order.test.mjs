import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const abc = fileURLToPath(new URL('./abc.mjs', import.meta.url))
const adapter = fileURLToPath(new URL('./fixtures/abc-order-adapter.mjs', import.meta.url))
for (const [mode, expected] of [['held', 1], ['independent-slow', 0]]) {
  test('background order: ' + mode, { timeout: 180000 }, async (t) => {
    const prefix = join(tmpdir(), 'gugu-lane91-abc-order-'), work = mkdtempSync(prefix)
    t.after(async () => {
      const pid = Number(readFileSync(join(work, 'adapter.pid'), 'utf8'))
      let alive = true
      for (let i = 0; i < 500 && alive; i++) {
        try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 10)) } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false }
      }
      assert.equal(alive, false, 'fixture adapter must have exited')
      console.log('remove own fixture directory', work); assert.ok(work.startsWith(prefix)); rmSync(work, { recursive: true })
    })
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ABC_|ANTHROPIC_|OPENAI_)/.test(key)))
    env.ABC_ORDER_FIXTURE = mode
    const result = await new Promise((resolve) => execFile(process.execPath, [abc, '--adapter', adapter, '--cli', process.execPath, '--work', work], { env, timeout: 160000 }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })))
    console.log(mode, result.stdout, result.stderr)
    assert.equal(result.code, expected)
    const verdict = JSON.parse(result.stdout.trim().split('\n').at(-1))
    assert.equal(verdict.verdict, expected ? 'FAIL' : 'PASS')
    if (expected) assert.equal(verdict.step, 'B/held-for-subagent')
    else assert.ok(verdict.results.BOrder.parentEnd.order < verdict.results.BOrder.childComplete.order)
  })
}
