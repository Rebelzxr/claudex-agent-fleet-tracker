import { expect, mock, test } from 'claude-code/testing'

const bucket = (usd: number, extra: Record<string, unknown> = {}) => ({
  claude: { 'claude': { input: 10, output: 4000, output_exact: 4000, cache_read: 1_000_000, cache_write_5m: 2000, cache_write_1h: 3000, replies: 3 } },
  codex: { runs: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0, total_upper: 0, drops: 0 },
  voice_chars: 0, active_s: 3600, span: [1_767_373_605, 1_767_403_930], usd, unpriced: 0,
  ...extra,
})
const codex = { runs: 11, input: 1, cached: 1, output: 1, reasoning: 0, total: 10_000_000, total_upper: 10_000_000, drops: 0 }

const BOARD = {
  generated: 1_767_403_930,
  jobs: [
    { id: 'A01', title: 'A01 video', lane: 'CONTENT', status: 'active', done: 6, total: 10, next: 'thumbnails', updated: 1_767_403_900,
      cost: { total: bucket(12.34, { codex }), phases: [bucket(5.25, { phase: 'build' }), bucket(4.50, { phase: 'script' })], chats: ['CONTENT DIRECTOR'] } },
    { id: 'A02', title: 'A02 video', lane: 'CONTENT', status: 'blocked', done: 1, total: 8, next: 'voice', updated: 1_767_403_800,
      cost: { total: bucket(2.50), phases: [bucket(3.1, { phase: 'direction' })], chats: ['CONTENT DIRECTOR'] } },
    { id: 'STORY', title: 'STUDIO Paper Planes', lane: 'STUDIO', status: 'active', done: 3, total: 9, next: 'script R2', updated: 1_767_403_700,
      cost: { total: bucket(0.75), phases: [bucket(0.75, { phase: 'research' })], chats: ['STUDIO'] } },
    { id: 'SITE', title: 'sample site header fit', lane: 'WEBSITE', status: 'proposed', done: 0, total: 4, next: null, updated: 1_767_403_600, cost: null },
  ],
  chats: [{ id: 'c1', title: 'CONTENT DIRECTOR', total: bucket(60), coordination: bucket(20), jobs_usd: 40, jobs: ['A01'], has_cost_state: true }],
  prices: { note: 'API-equivalent cost (not billed)', as_of: '2026-01-01' },
}
const pane = (cols: number) => ({ title: 'HQ board', isFocused: false, bodyColumns: cols, placement: 'dock' })

async function open($: any, on: any, cols: number, surface: 'desktop' | 'terminal') {
  const store: Record<string, unknown> = { hqSession: 'hq-1', wire: [{ at: 1_767_403_900_000, dir: 'in', who: 'DESIGN DIRECTOR', what: 'x', status: 'delivered' }] }
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('env.get', ((_$: any, e: any) => ({ value: e.name === 'FLEET_ROOT' ? '/x/fleet' : e.name === 'FLEET_BOARD_SCRIPT' ? '/x/fleet_board.py' : '' })) as any)
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify(BOARD), stderr: '' } })) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  mock.clock(on, { now: 1_767_403_930_300 })
  await $.command.run({ command: 'board' })
  return { store, ui: await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: pane(cols) }) }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`jobs sit under their lane headers, key numbers bold, on ${surface}`, async ($, on) => {
    const { ui } = await open($, on, 160, surface)
    const lane = await ui.find({ type: 'Text', text: /^▌ CONTENT$/ })
    expect(lane?.props.bold).toBe(true)
    expect(lane?.props.color).toBe('cyan')
    expect(await ui.find({ type: 'Text', text: /^▌ CONTENT {2}2 jobs · ~?\$14\.84 · ctx 2\.0M · Codex 10\.0M ×11$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▌ WEBSITE {2}1 job · / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▌ STUDIO {2}1 job · \$0\.75 · ctx 1\.0M$/ })).toBeDefined()
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
    const at = (re: RegExp) => texts.findIndex((t: string) => re.test(t))
    expect(at(/^▌ CONTENT /)).toBeLessThan(at(/^▸ A01 video/))
    expect(at(/^▸ A01 video/)).toBeLessThan(at(/^▸ A02 video/))
    expect(at(/^▸ A02 video/)).toBeLessThan(at(/^▌ STUDIO /))
    expect(at(/^▌ STUDIO /)).toBeLessThan(at(/^▸ STUDIO Paper Planes/))
    expect(at(/^▸ STUDIO Paper Planes/)).toBeLessThan(at(/^▌ WEBSITE /))
    expect(await ui.find({ type: 'Text', text: /^4 open · 2 active · 1 blocked {3}~?\$15\.59 · 3\.0h work · Claude out 12k · ctx 3\.0M · Codex 10\.0M in 11 runs$/ })).toBeDefined()
    const ctx = (await ui.findAll({ type: 'Text', text: /^3\.0M$/ }))[0]
    expect(ctx?.props.bold).toBe(true)
    const cost = await ui.find({ type: 'Text', text: /^\s*\$12\.34$/ })
    expect(cost?.props.bold).toBe(true)
    expect(cost?.props.color).toBe('green')
    const codexCell = await ui.find({ type: 'Text', text: /^\s+10\.0M$/ })
    expect(codexCell?.props.color).toBe('magenta')
    await ui.unmount()
  })

  test(`columns line up with their headers, wide and narrow, on ${surface}`, async ($, on) => {
    const wide = await open($, on, 160, surface)
    const head = (await wide.ui.find({ type: 'Text', text: /^ {2}JOB +STATUS +PROGRESS +COST +WORK +OUT +CTX +CODEX +RUNS$/ }))!
    expect(head.props.mono).toBe(true)
    const l03 = (await wide.ui.find({ type: 'Text', text: /^▸ A01 video/ }))!
    expect(l03.props.mono).toBe(true)
    expect(l03.text.trimEnd().length).toBe(head.text.length)
    expect(l03.text.indexOf('$12.34') + 6).toBe(head.text.indexOf('COST') + 4)
    expect(l03.text.indexOf('1.0M') + 4).toBe(head.text.indexOf('CTX') + 3)
    expect(l03.text.trimEnd().endsWith('11')).toBe(true)
    const site = (await wide.ui.find({ type: 'Text', text: /^▸ sample site header fit/ }))!
    expect(site.text.trimEnd().length).toBe(head.text.length)
    expect(site.text.indexOf('—') + 1).toBe(head.text.indexOf('COST') + 4)
    await wide.ui.unmount()

    const narrow = await $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: pane(60) as any })
    const top = (await narrow.find({ type: 'Text', text: /^ {2}JOB +STATUS *$/ }))!
    const bottom = (await narrow.find({ type: 'Text', text: /^ {2}PROGRESS +COST +WORK +OUT +CTX +CODEX +RUNS$/ }))!
    expect(top.text.length).toBeLessThanOrEqual(60)
    expect(bottom.text.length).toBeLessThanOrEqual(60)
    const numbers = (await narrow.find({ type: 'Text', text: /^ {2}[█░]{6} +6\/10/ }))!
    expect(numbers.text.trimEnd().length).toBe(bottom.text.length)
    expect(numbers.text.indexOf('$12.34') + 6).toBe(bottom.text.indexOf('COST') + 4)
    await narrow.unmount()
  })

  test(`one job's phases open at a time, and each press is in the diag ring on ${surface}`, async ($, on) => {
    const { ui, store } = await open($, on, 160, surface)
    await ui.press({ key: 'phases-A01' })
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /next: thumbnails/ })).toBeDefined()
    expect(await ui.find({ key: 'phases-A01', type: 'Button' })).toMatchObject({ text: 'phases' })
    expect(await ui.find({ type: 'Text', text: /^▾ A01 video/ })).toBeDefined()
    await ui.press({ key: 'phases-STORY' })
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\s*research/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▸ A01 video/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▾ STUDIO Paper Planes/ })).toBeDefined()
    expect(await ui.find({ key: 'phases-SITE' })).toMatchObject({ text: 'details' })
    await ui.press({ key: 'phases-STORY' })
    expect(await ui.find({ type: 'Text', text: /^\s*research/ })).toBeUndefined()
    await ui.unmount()
    const ring = (store['diag:hq-1'] as any[]) ?? []
    expect(ring.filter(d => d.step === 'press').map(d => [d.key, d.reached, d.surface])).toEqual([
      ['phases-A01', 'phases-A01', surface], ['phases-STORY', 'phases-STORY', surface], ['phases-STORY', 'phases-STORY', surface],
    ])
    const draws = ring.filter(d => d.step === 'draw')
    expect(draws.map(d => d.open)).toEqual([null, 'A01', 'STORY', null])
    expect(draws.every(d => d.surface === surface && d.cols === 160 && d.bytes > 0 && d.nodes > 0 && d.trim === 0)).toBe(true)
  })
}

test('the band above the prompt still shows the last messages and the active jobs', async ($, on) => {
  await open($, on, 160, 'terminal')
  const band = await $.ui.mount({ plugin: 'hq-board', surface: 'terminal', component: 'AbovePrompt', requestId: 'above-prompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any })
  expect(await band.find({ type: 'Text', text: /⬅ DESIGN DIRECTOR .* 2 active jobs \(\/board\)/ })).toBeDefined()
  await band.unmount()
})

test('/board-hq makes this chat the HQ', async ($, on) => {
  const store: Record<string, unknown> = {}
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-7' })) as any)
  const out: any = await $.command.run({ command: 'board-hq' } as any)
  expect(String(out?.text)).toMatch(/now the HQ/)
  expect(store.hqSession).toBe('hq-7')
})
