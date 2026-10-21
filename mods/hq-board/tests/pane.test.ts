import { expect, mock, test } from 'claude-code/testing'

const bucket = (usd: number) => ({
  claude: { 'claude': { input: 1000, output: 2000, output_exact: 2000, cache_read: 50000, cache_write_5m: 0, cache_write_1h: 0, replies: 9 } },
  codex: { runs: 1, input: 1, cached: 0, output: 1, reasoning: 0, total: 2 },
  voice_chars: 0, active_s: 900, span: [1_767_425_600, 1_767_425_960], usd, unpriced: 0,
})
const board = {
  generated: 1_767_443_600,
  jobs: Array.from({ length: 80 }, (_, i) => ({
    id: `JOB-${String(i).padStart(2, '0')}`, title: `Job number ${i} with a fairly long working title`, lane: 'WEBSITE',
    status: 'active', done: i % 7, total: 7, next: 'x'.repeat(120), updated: 1_767_425_600 + i * 60, started: 1_767_424_600,
    cost: { total: { ...bucket(i), phases: undefined }, phases: [{ ...bucket(1), phase: 'build' }], chats: ['<DIRECTOR_SESSION_ID>'] },
  })),
  chats: Array.from({ length: 40 }, (_, i) => ({ id: `chat-${i}-0000`, title: `Chat ${i}`, total: bucket(i), coordination: bucket(0), jobs_usd: i, jobs: [], has_cost_state: true })),
  prices: { as_of: '2026-01-01', note: 'API-equivalent cost' },
}
const PANE = { title: 'HQ board', isFocused: false, bodyColumns: 60, placement: 'dock' } as any
const KNOWN_GOOD = { bytes: 28000, nodes: 330 }
const count = (n: any): number =>
  Array.isArray(n) ? n.reduce((k: number, x: any) => k + count(x), 0) : n && typeof n === 'object' ? 1 + count(n.children) : 0

const setUp = (on: any, data: unknown = board) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 17, 8, 0) })
  const store: Record<string, unknown> = {
    hqSession: 'hq-1',
    wire: Array.from({ length: 120 }, (_, i) => ({ at: 1_767_425_600_000 + i * 1000, dir: i % 2 ? 'in' : 'out', who: `Chat ${i}`, what: 'hello' })),
  }
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('env.get', ((_$: any, e: any) => ({ value: e.name === 'FLEET_ROOT' ? '/x/fleet' : e.name === 'FLEET_BOARD_SCRIPT' ? '/x/fleet_board.py' : '' })) as any)
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  return store
}

// Same fields as scripts/fleet_board.py: step counts and next action, no cost buckets.
const costless = {
  generated: 1_767_443_600, timezone: 'UTC', chats: [], errors: [],
  prices: { note: 'Cost ledger omitted; missing usage is unknown, not a bill' },
  jobs: ['active', 'blocked', 'review', 'done'].map((status, i) => ({
    id: `FREE-${status}`, title: `Costless ${status}`, lane: 'TOOLS', status, session: null,
    done: status === 'done' ? 3 : 1, total: 3,
    next: status === 'done' ? null : `Check ${status} result`,
    blocked_on: status === 'blocked' ? 'Human: choose the sample' : null,
    cost: null, started: null, updated: 1_767_425_600 + i * 60,
  })),
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`done jobs with null cost are counted and can be shown and hidden on ${surface}`, async ($, on) => {
    setUp(on, costless)
    await $.command.run({ command: 'board' })
    const ui = await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: PANE })
    expect(JSON.stringify(await ui.drawn())).toContain('done jobs (1)')
    expect(await ui.find({ type: 'Text', text: /newest 3 of 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Costless done/ })).toBeUndefined()
    await ui.press({ key: 'toggle-done' })
    expect(await ui.find({ type: 'Text', text: /newest 4 of 4 · incl. 1 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Costless done/ })).toBeDefined()
    await ui.press({ key: 'phases-FREE-done' })
    expect(await ui.find({ type: 'Text', text: /next: —/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /steps: 3\/3 complete/ })).toBeDefined()
    await ui.press({ key: 'toggle-done' })
    expect(await ui.find({ type: 'Text', text: /Costless done/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`null-cost jobs expand next actions, blockers and steps on ${surface}`, async ($, on) => {
    setUp(on, costless)
    await $.command.run({ command: 'board' })
    const ui = await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: { ...PANE, bodyColumns: 160 } })
    expect(await ui.find({ type: 'Text', text: /next: Check active result/ })).toBeUndefined()
    await ui.press({ key: 'phases-FREE-active' })
    expect(await ui.find({ type: 'Text', text: /next: Check active result/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /steps: 1\/3 complete/ })).toBeDefined()
    await ui.press({ key: 'phases-FREE-review' })
    expect(await ui.find({ type: 'Text', text: /next: Check active result/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /next: Check review result/ })).toBeDefined()
    await ui.press({ key: 'phases-FREE-blocked' })
    expect(await ui.find({ type: 'Text', text: /next: Check blocked result/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /blocked on: Human: choose the sample/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /steps: 1\/3 complete/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache read|estimate basis|chats:/ })).toBeUndefined()
    await ui.press({ key: 'phases-FREE-blocked' })
    expect(await ui.find({ type: 'Text', text: /next: Check blocked result/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`every state the pane can reach stays drawable on ${surface}, and paging reaches every job`, async ($, on) => {
    const store = setUp(on)
    await ($.command.run as any)({ command: 'board', args: '' })
    const ui = await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: PANE })
    const drawable = async () => {
      const tree = await ui.drawn()
      expect(JSON.stringify(tree).length).toBeLessThan(KNOWN_GOOD.bytes)
      expect(count(tree)).toBeLessThanOrEqual(KNOWN_GOOD.nodes)
    }

    await drawable()
    expect(await ui.find({ type: 'Text', text: /Job number 79/ } as any)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Job number 60 / } as any)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Chat 119/ } as any)).toBeDefined()
    expect(Array.isArray(store['diag:hq-1']) && (store['diag:hq-1'] as any[]).some(d => d.step === 'open')).toBe(true)

    await ui.press({ key: 'toggle-jobs' })
    await drawable()
    expect(await ui.find({ type: 'Text', text: /jobs 1–12 of 80 · page 1 of 7/ } as any)).toBeDefined()
    await ui.press({ key: 'jobs-prev' })
    expect(await ui.find({ type: 'Text', text: /page 1 of 7/ } as any)).toBeDefined()
    for (let page = 2; page <= 7; page++) {
      await ui.press({ key: 'jobs-next' })
      await drawable()
      expect(await ui.find({ type: 'Text', text: new RegExp(`page ${page} of 7`) } as any)).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Job number 0 / } as any)).toBeDefined()
    expect(await ui.find({ key: 'jobs-next' })).toBeDefined()

    await ui.press({ key: 'phases-JOB-00' })
    await drawable()
    expect(await ui.find({ type: 'Text', text: /^\s*build/ } as any)).toBeDefined()
    await ui.press({ key: 'toggle-chats' })
    await drawable()
    expect(await ui.find({ type: 'Text', text: /chats 1–\d+ of 40 · page 1 of 3/ } as any)).toBeDefined()
    await ui.press({ key: 'chats-next' })
    await drawable()
    expect(await ui.find({ type: 'Text', text: /^Chat 20\b/ } as any)).toBeDefined()

    await ui.press({ key: 'jobs-newest' })
    await drawable()
    expect(await ui.find({ type: 'Text', text: /Job number 79/ } as any)).toBeDefined()
    expect(await ui.find({ key: 'jobs-next' })).toBeUndefined()
    await ui.unmount()

    const ring = (store['diag:hq-1'] as any[]) ?? []
    const presses = ring.filter(d => d.step === 'press')
    expect(presses.map(p => p.key)).toEqual(['toggle-jobs', 'jobs-prev', 'jobs-next', 'jobs-next', 'jobs-next', 'jobs-next', 'jobs-next', 'jobs-next', 'phases-JOB-00', 'toggle-chats', 'chats-next', 'jobs-newest'])
    expect(presses.every(p => p.reached === p.key && p.surface === surface)).toBe(true)
    for (const p of presses.filter(p => p.key !== 'jobs-prev')) {
      const after = ring.slice(ring.indexOf(p) + 1).find(d => d.step === 'draw')
      expect(after).toBeDefined()
      expect(after.bytes).toBeLessThanOrEqual(25000)
      expect(after.nodes).toBeLessThanOrEqual(KNOWN_GOOD.nodes)
    }
    expect(ring.map(d => d.n)).toEqual([...ring.map(d => d.n)].sort((a, b) => a - b))
  })
}
