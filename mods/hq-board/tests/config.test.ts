import { expect, mock, test } from 'claude-code/testing'

const DATA = { generated: Date.UTC(2026, 0, 1) / 1000, jobs: [], timezone: 'UTC' }

function setup(on: any, options: { missing?: boolean; failure?: boolean; invalid?: boolean; usage?: boolean } = {}) {
  const calls: any[] = []
  const store: Record<string, any> = { hqSession: 'hq-sample', wire: [] }
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-sample' })) as any)
  on('env.get', ((_$: any, e: any) => ({ value: options.missing ? '' : ({
    FLEET_ROOT: '/x/sample fleet', FLEET_BOARD_SCRIPT: '/x/tools/board script.py', FLEET_TIMEZONE: 'UTC',
    ...(options.usage ? { FLEET_USAGE: '1', FLEET_CLAUDE_PROJECTS: '/x/transcripts', FLEET_CODEX_HOME: '/x/codex', FLEET_CODEX: '0' } : {}),
  } as any)[e.name] })) as any)
  on('process.run', ((_$: any, e: any) => {
    calls.push(e)
    return { value: { exitCode: options.failure ? 2 : 0, stdout: options.invalid ? 'bad json' : JSON.stringify(DATA), stderr: '' } }
  }) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  mock.clock(on, { now: Date.UTC(2026, 0, 1) })
  return { calls, store }
}

test('uses configured paths as process arguments and formats a configured zone', async ($, on) => {
  const { calls } = setup(on)
  await $.command.run({ command: 'board' })
  expect(calls.length).toBe(1)
  const call = JSON.stringify(calls[0])
  expect(call).toContain('/x/sample fleet')
  expect(call).toContain('/x/tools/board script.py')
  expect(call).toContain('--timezone')
  const ui = await $.ui.mount({ plugin: 'hq-board', surface: 'terminal', component: 'Pane', requestId: 'hq-board', props: { bodyColumns: 100 } as any })
  expect(await ui.find({ type: 'Text', text: /UTC · newest/ })).toBeDefined()
  await ui.unmount()
})

test('usage stays off unless FLEET_USAGE is set', async ($, on) => {
  const off = setup(on)
  await $.command.run({ command: 'board' })
  expect(JSON.stringify(off.calls[0])).not.toContain('--usage')
})

test('FLEET_USAGE passes --usage and the transcript folder', async ($, on) => {
  const { calls } = setup(on, { usage: true })
  await $.command.run({ command: 'board' })
  const call = JSON.stringify(calls[0])
  expect(call).toContain('--usage')
  expect(call).toContain('/x/transcripts')
  expect(call).toContain('/x/codex')
  expect(call).toContain('--no-codex')
})

test('missing config does not run a process', async ($, on) => {
  const { calls } = setup(on, { missing: true })
  await $.command.run({ command: 'board' })
  expect(calls.length).toBe(0)
})

for (const mode of ['failure', 'invalid'] as const) {
  test(`a ${mode} refresh keeps the last valid snapshot`, async ($, on) => {
    const options: { failure?: boolean; invalid?: boolean } = {}
    setup(on, options)
    await $.command.run({ command: 'board' })
    options[mode] = true
    await $.command.run({ command: 'board' })
    const ui = await $.ui.mount({ plugin: 'hq-board', surface: 'terminal', component: 'Pane', requestId: 'hq-board', props: { bodyColumns: 100 } as any })
    expect(await ui.find({ type: 'Text', text: /updated .*Jan/ })).toBeDefined()
    await ui.unmount()
  })
}

test('incoming bodies never enter the stored message metadata', async ($, on) => {
  const { store } = setup(on)
  on('session.receive', (() => ({ text: 'accepted' })) as any)
  await $.session.receive({ text: '<peer name="HIDDEN_BODY_FIELD">HIDDEN_BODY_MARKER', origin: { kind: 'peer', teammate: 'CONTENT DIRECTOR' } } as any)
  expect(store.wire.length).toBe(1)
  expect(store.wire[0].what).toBe('')
  expect(store.wire[0].who).toBe('CONTENT DIRECTOR')
  expect(JSON.stringify(store.wire)).not.toContain('HIDDEN_BODY_MARKER')
})


test('reviewer commands and descriptions never enter the stored message metadata', async ($, on) => {
  const { store } = setup(on)
  on('tool.call', (() => ({ result: 'ok', text: 'finished' })) as any)
  await ($.tool.call as any)({ tool: 'Bash', command: "codex exec 'HIDDEN_INLINE_PROMPT'", description: 'HIDDEN_DESCRIPTION_BODY' })
  expect(store.wire.length).toBe(1)
  expect(store.wire[0].what).toBe('')
  expect(JSON.stringify(store.wire)).not.toContain('HIDDEN_INLINE_PROMPT')
  expect(JSON.stringify(store.wire)).not.toContain('HIDDEN_DESCRIPTION_BODY')
})
