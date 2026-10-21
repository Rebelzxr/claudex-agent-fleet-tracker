import { expect, mock, test } from 'claude-code/testing'

const bucket = (usd: number) => ({
  claude: { 'claude': { input: 10, output: 4000, output_exact: 4000, cache_read: 1_000_000, cache_write_5m: 0, cache_write_1h: 0, replies: 3 } },
  codex: { runs: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0 },
  voice_chars: 0, active_s: 600, span: [1_767_373_605, 1_767_403_930], usd, unpriced: 0,
})
const BOARD = {
  generated: 1_767_403_930,
  jobs: [
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `J${i}`, title: `Job ${i}`, lane: i % 2 ? 'STUDIO' : 'HQ', status: 'active', done: 1, total: 4, next: 'n', updated: 1_767_403_600 + i,
      cost: { total: bucket(i), phases: [{ ...bucket(i), phase: 'build' }], chats: ['x'] },
    })),
    { id: 'OLD', title: 'Old job', lane: 'HQ', status: 'done', done: 4, total: 4, next: null, updated: 1_767_395_600,
      cost: { total: bucket(1), phases: [{ ...bucket(1), phase: 'build' }], chats: ['x'] } },
  ],
  chats: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, title: `CHAT ${i}`, total: bucket(30 - i), coordination: bucket(0), jobs_usd: 0, jobs: [], has_cost_state: true })),
  prices: { note: 'API-equivalent cost', as_of: '2026-01-01' },
}
const pane = (offset: number) => ({ title: 'HQ board', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset, bodyRows: 40 } }) as any

/** key → the handle each drawn Button carries. */
const handles = (n: any, out: Record<string, number> = {}): Record<string, number> => {
  if (Array.isArray(n)) n.forEach(x => handles(x, out))
  else if (n && typeof n === 'object') {
    if (n.type === 'Button') out[n.props.key] = n.press.handle
    handles(n.children, out)
  }
  return out
}

async function open($: any, on: any, surface: 'desktop' | 'terminal') {
  const store: Record<string, unknown> = { hqSession: 'hq-1', wire: [] }
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('store.keys', (() => ({ value: Object.keys(store) })) as any)
  on('store.delete', ((_$: any, e: any) => { delete store[e.key]; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('env.get', ((_$: any, e: any) => ({ value: e.name === 'FLEET_ROOT' ? '/x/fleet' : e.name === 'FLEET_BOARD_SCRIPT' ? '/x/fleet_board.py' : '' })) as any)
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify(BOARD), stderr: '' } })) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  mock.clock(on, { now: 1_767_403_930_300 })
  await $.command.run({ command: 'board' })
  return { store, ui: await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: pane(0) }) }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`every Button keeps its handle through a scroll burst on ${surface}`, async ($, on) => {
    const { ui } = await open($, on, surface)
    await ui.press({ key: 'toggle-jobs' })
    const before = handles(await ui.drawn())
    expect(Object.keys(before)).toEqual(expect.arrayContaining(['jobs-newest', 'toggle-jobs', 'jobs-prev', 'jobs-next', 'toggle-done', 'chats-top', 'toggle-chats']))
    for (let step = 1; step <= 7; step++) await ui.redraw(pane(step * 3))
    expect(handles(await ui.drawn())).toEqual(before)
    await ui.unmount()
  })

  test(`a fast double press lands twice and toggles stay where they are on ${surface}`, async ($, on) => {
    const { ui, store } = await open($, on, surface)
    await ui.press({ key: 'toggle-jobs' })
    const first = handles(await ui.drawn())
    await ui.press({ key: 'jobs-next' })
    expect(handles(await ui.drawn())['jobs-next']).toBe(first['jobs-next'])
    await ui.press({ key: 'jobs-next' })
    expect(await ui.find({ type: 'Text', text: /page 3 of 4/ })).toBeDefined()
    await ui.press({ key: 'jobs-next' })
    await ui.press({ key: 'jobs-next' })
    expect(await ui.find({ type: 'Text', text: /page 4 of 4/ })).toBeDefined()
    expect(handles(await ui.drawn())['jobs-next']).toBe(first['jobs-next'])
    await ui.press({ key: 'jobs-newest' })
    const newest = handles(await ui.drawn())
    expect(newest['jobs-newest']).toBe(first['jobs-newest'])
    await ui.press({ key: 'jobs-newest' })
    expect(await ui.find({ type: 'Text', text: /page \d of/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Job 39/ })).toBeDefined()
    const phases = newest['phases-J39']
    await ui.press({ key: 'phases-J39' })
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeDefined()
    expect(handles(await ui.drawn())['phases-J39']).toBe(phases)
    await ui.press({ key: 'phases-J39' })
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeUndefined()
    await ui.unmount()

    const ring = (store['diag:hq-1'] as any[]) ?? []
    expect(ring.filter(d => d.step === 'press').map(d => [d.key, d.reached])).toEqual([
      ['toggle-jobs', 'toggle-jobs'], ['jobs-next', 'jobs-next'], ['jobs-next', 'jobs-next'], ['jobs-next', 'jobs-next'], ['jobs-next', 'jobs-next'],
      ['jobs-newest', 'jobs-newest'], ['jobs-newest', 'jobs-newest'], ['phases-J39', 'phases-J39'], ['phases-J39', 'phases-J39'],
    ])
  })

  test(`the diag ring is per session, in order, and logs a draw only when it changed on ${surface}`, async ($, on) => {
    const { ui, store } = await open($, on, surface)
    for (let step = 1; step <= 7; step++) await ui.redraw(pane(step * 3))
    await ui.press({ key: 'toggle-chats' })
    await ui.unmount()
    expect(store.diag).toBeUndefined()
    const ring = store['diag:hq-1'] as any[]
    expect(ring.map(d => d.step)).toEqual(['open', 'draw', 'press', 'draw'])
    expect(ring.map(d => d.n)).toEqual([...ring.map(d => d.n)].sort((a, b) => a - b))
    expect(new Set(ring.map(d => d.n)).size).toBe(ring.length)
    const last = ring[3]
    expect(last.skipped).toBe(7)
    expect(last.why).toEqual({ scroll: 7 })
    expect(last.chats).toBe('p0')
  })
}
