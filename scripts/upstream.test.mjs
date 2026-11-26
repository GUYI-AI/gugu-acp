import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { stableReleaseTags } from './upstream-tags.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const commit = (repo, message) => git(
  '-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
  'commit', '-q', '--allow-empty', '-m', message,
)

test('annotated tag resolves to one candidate and the build verifies its pinned commit', (t) => {
  const prefix = join(tmpdir(), 'gugu-acp-upstream-')
  const root = mkdtempSync(prefix)
  t.after(() => {
    assert.ok(root.startsWith(prefix))
    console.log('remove fixture directory', root)
    rmSync(root, { recursive: true })
  })

  const upstream = join(root, 'upstream')
  git('init', '-q', upstream)
  commit(upstream, 'Previous release')
  const previous = git('-C', upstream, 'rev-parse', 'HEAD')
  git('-C', upstream, 'tag', 'v0.0.34')
  writeFileSync(join(upstream, 'package.json'), JSON.stringify({ name: 'upstream-fixture', version: '0.0.35' }))
  git('-C', upstream, 'add', 'package.json')
  commit(upstream, 'Annotated release')
  const target = git('-C', upstream, 'rev-parse', 'HEAD')
  git('-C', upstream, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'tag', '-am', 'Release 0.0.35', 'v0.0.35')
  const tagObject = git('-C', upstream, 'rev-parse', 'v0.0.35')

  const repo = pathToFileURL(upstream).href
  const refs = git('ls-remote', '--tags', repo)
  assert.notEqual(tagObject, target)
  assert.ok(refs.split('\n').includes(tagObject + '\trefs/tags/v0.0.35'))
  assert.ok(refs.split('\n').includes(target + '\trefs/tags/v0.0.35^{}'))
  const candidates = stableReleaseTags(refs).sort((a, b) => a.tag.localeCompare(b.tag))
  assert.deepEqual(candidates, [
    { tag: 'v0.0.34', commit: previous },
    { tag: 'v0.0.35', commit: target },
  ])

  const buildRoot = join(root, 'build')
  const scripts = join(buildRoot, 'scripts')
  const bridge = join(buildRoot, 'bridges', 'fixture')
  git('init', '-q', buildRoot)
  mkdirSync(scripts, { recursive: true })
  mkdirSync(bridge, { recursive: true })
  const build = join(scripts, 'build.mjs')
  copyFileSync(new URL('./build.mjs', import.meta.url), build)
  const pin = (commit) => writeFileSync(join(bridge, 'bridge.json'), JSON.stringify({
    package: 'bridge-fixture',
    version: '1.0.0',
    upstream: { repo, tag: candidates[1].tag, commit },
    build: [],
    test: [],
  }))
  pin(previous)
  git('-C', buildRoot, 'add', 'bridges')
  commit(buildRoot, 'Pin the fixture bridge')

  const runBuild = () => spawnSync(process.execPath, [build, 'fixture'], { cwd: buildRoot, encoding: 'utf8' })
  const wrong = runBuild()
  assert.equal(wrong.status, 2, wrong.stderr)
  assert.ok(wrong.stderr.includes(`FAIL step=clone: tag v0.0.35 is ${target}, bridge.json pins ${previous}`))

  pin(candidates[1].commit)
  const correct = runBuild()
  assert.equal(correct.status, 0, correct.stderr)
  assert.ok(existsSync(correct.stdout.trim().split('\n').at(-1)))
})
