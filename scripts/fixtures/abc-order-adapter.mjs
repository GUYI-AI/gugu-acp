// Deterministic ACP v2 frames with the same subagent/state shape as the real bridge.
import readline from 'node:readline'
import { writeFileSync } from 'node:fs'
writeFileSync('adapter.pid', String(process.pid))
const root = 'parent', child = 'child-b'
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\n')
const update = (value) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: root, update: value } })
const idle = () => update({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' })
const childState = (state) => update({ sessionUpdate: 'subagent_update', sessionId: child, state })
const input = readline.createInterface({ input: process.stdin })
input.on('close', () => process.exit(0))
input.on('line', (line) => {
  const m = JSON.parse(line), result = (value) => send({ jsonrpc: '2.0', id: m.id, result: value })
  if (m.method === 'initialize') return result({ protocolVersion: 2, info: { name: 'abc-order-fixture', version: '1' }, capabilities: {} })
  if (m.method === 'session/new') return result({ sessionId: root })
  if (m.method === 'session/set_config_option') return result({})
  if (m.method === '_session/steering') { result({ outcome: 'injected' }); idle(); return }
  if (m.method !== 'session/prompt') throw Error('Unexpected method ' + m.method)
  const text = m.params.prompt[0].text
  result({ messageId: 'fixture-message' })
  update({ sessionUpdate: 'state_update', state: 'running' })
  if (text.startsWith('Reply with just: hi')) { idle(); return }
  if (!text.startsWith('Launch exactly ONE')) return // C ends when steering arrives.
  childState({ state: 'running' })
  if (process.env.ABC_ORDER_FIXTURE === 'held') {
    childState({ state: 'idle', stopReason: 'end_turn' }); idle()
  } else {
    // A slow model still satisfies the protocol: the parent ends before its child.
    setTimeout(() => { idle(); childState({ state: 'idle', stopReason: 'end_turn' }); update({ sessionUpdate: 'state_update', state: 'running' }); idle() }, 16000)
  }
})
