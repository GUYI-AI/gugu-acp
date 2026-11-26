import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2]
const base = process.env
const authKeys = ['ABC_ANTHROPIC_BASE_URL', 'ABC_ANTHROPIC_AUTH_TOKEN', 'ABC_ANTHROPIC_MODEL']
const configured = Object.fromEntries(authKeys.map((name) => [name, Boolean(base[name])]))
console.log(JSON.stringify({ auth: configured }))
if (!root || !Object.values(configured).every(Boolean)) throw new Error('A matrix requires an explicit endpoint, token, and model')

const abc = fileURLToPath(new URL('./abc.mjs', import.meta.url))
const cleanEnv = Object.fromEntries(Object.entries(base).filter(([name]) => !/^(ANTHROPIC_|CLAUDE_)/.test(name)))

function run(command, args, label, timeout, auth = {}) {
  const cwd = mkdtempSync(join(root, label + '-'))
  const config = join(cwd, 'claude-config')
  mkdirSync(config)
  return spawnSync(command, args, {
    cwd,
    env: { ...cleanEnv, ...auth, CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' },
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
  })
}

function finalJson(stdout) {
  try { return JSON.parse((stdout ?? '').trim().split('\n').at(-1)) } catch { return null }
}

function failureCodes(result) {
  const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '')
  const matches = output.match(/\b(?:authentication_error|permission_error|rate_limit_error|overloaded_error|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b|\b(?:status(?: code)?|HTTP|API Error)[: ="]+(?:401|403|404|429|500|502|503|504)\b/gi) ?? []
  return [...new Set(matches)]
}

let failed = false
for (const cliVersion of ['2.1.328', '2.1.332']) {
  const cli = join(root, 'cli-' + cliVersion, 'node_modules', '.bin', 'claude')
  let anyBridgePassed = false
  for (const bridge of ['1.7.1', '1.7.2']) {
    const adapter = join(root, 'bridge-' + bridge, 'node_modules', '@gugu-acp', 'claude-agent-acp')
    const manifest = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'))
    if (manifest.version !== bridge) throw new Error('Unexpected bridge version ' + manifest.version)
    if (bridge === '1.7.2' && !manifest.gugu?.patches.some((patch) => patch.startsWith('0018-'))) {
      throw new Error('Candidate does not contain patch 0018')
    }
    const result = run(process.execPath, [abc, '--adapter', join(adapter, 'dist', 'index.js'), '--cli', cli, '--a-only'], 'acp', 145_000)
    const data = finalJson(result.stdout)
    const correctCli = data?.cliVersion === cliVersion + ' (Claude Code)'
    const pass = correctCli && result.status === 0 && data?.verdict === 'PASS' && data?.step === 'A'
    console.log(JSON.stringify({
      bridge,
      requestedCli: cliVersion,
      cliVersion: correctCli ? data.cliVersion : 'unverified',
      pass,
      exit: result.status,
      step: data?.step ?? null,
      stopReason: data?.results?.A ?? null,
      progress: data?.results?.AProgress ?? null,
      failureCodes: failureCodes(result),
      spawnError: result.error?.code ?? null,
    }))
    anyBridgePassed ||= pass
    failed ||= !pass
  }
  if (!anyBridgePassed) {
    const direct = run(cli, ['--print', '--output-format', 'json', 'Reply with just: hi'], 'direct', 75_000, {
      ANTHROPIC_BASE_URL: base.ABC_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: base.ABC_ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_MODEL: base.ABC_ANTHROPIC_MODEL,
      ANTHROPIC_SMALL_FAST_MODEL: base.ABC_ANTHROPIC_MODEL,
    })
    const data = finalJson(direct.stdout)
    console.log(JSON.stringify({
      directCli: cliVersion,
      pass: direct.status === 0 && data?.is_error === false,
      exit: direct.status,
      failureCodes: failureCodes(direct),
      spawnError: direct.error?.code ?? null,
    }))
  }
}

process.exitCode = failed ? 1 : 0
