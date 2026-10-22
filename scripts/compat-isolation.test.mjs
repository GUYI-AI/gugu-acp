import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const compat = JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'))

// The release selector shipped in the v1 host (OpenDCAI/gugu a7ed972c).
// It does not understand protocolVersion and reads only this exact table key.
function legacyPick(cliVersion) {
  const releases = [...compat.bridges['claude-agent-acp'].releases].sort((a, b) => compare(a.cliFrom, b.cliFrom))
  let chosen
  for (const release of releases) if (compare(cliVersion, release.cliFrom) >= 0) chosen = release
  return chosen ?? releases[0]
}
function compare(a, b) {
  const pa = /(\d+)\.(\d+)\.(\d+)/.exec(a)
  const pb = /(\d+)\.(\d+)\.(\d+)/.exec(b)
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i])
  return 0
}

test('a released v1 host never discovers the v2 bridge, including future CLI versions', () => {
  assert.equal(compat.bridges['claude-agent-acp'].releases.at(-1).version, '1.4.1')
  for (const cli of ['2.1.304', '2.1.306', '2.9.999', '99.0.0']) assert.equal(legacyPick(cli).version, '1.4.1')
  assert.ok(compat.bridges['claude-agent-acp-v2'].releases.every((release) => release.protocolVersion === 2))
})

test('compat automation appends v2 releases only to the isolated key', () => {
  const work = mkdtempSync(join(tmpdir(), 'acp-v2-compat-test-'))
  try {
    mkdirSync(join(work, 'scripts'))
    mkdirSync(join(work, 'bridges', 'claude-agent-acp'), { recursive: true })
    cpSync(join(root, 'scripts', 'compat.mjs'), join(work, 'scripts', 'compat.mjs'))
    cpSync(join(root, 'bridges', 'claude-agent-acp', 'bridge.json'), join(work, 'bridges', 'claude-agent-acp', 'bridge.json'))
    writeFileSync(join(work, 'compat.json'), JSON.stringify(compat))
    execFileSync(process.execPath, [join(work, 'scripts', 'compat.mjs'), 'add-release', 'claude-agent-acp', '2.1.0', 'v0.95.0', '2.1.400', 'fixture'], { stdio: 'pipe' })
    const changed = JSON.parse(readFileSync(join(work, 'compat.json'), 'utf8'))
    assert.deepEqual(changed.bridges['claude-agent-acp'], compat.bridges['claude-agent-acp'])
    assert.equal(changed.bridges['claude-agent-acp-v2'].releases.at(-1).version, '2.1.0')
    assert.equal(changed.bridges['claude-agent-acp-v2'].releases.at(-1).protocolVersion, 2)
  } finally { rmSync(work, { recursive: true, force: true }) }
})
