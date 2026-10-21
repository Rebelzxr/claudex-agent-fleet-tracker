import { expect, mock, test } from 'claude-code/testing'

const bucket = (usd: number) => ({
  claude: { 'claude': { input: 10, output: 1000, output_exact: 1000, cache_read: 100_000, cache_write_5m: 0, cache_write_1h: 0, replies: 2 } },
  codex: { runs: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0 },
  voice_chars: 0, active_s: 60, span: [1_767_373_605, 1_767_403_930], usd, unpriced: 0,
})
const job = (id: string, lane: string, status: string, updated: number, extra: Record<string, unknown> = {}) => ({
  id, title: `${id} title`, lane, status, done: 1, total: 3, next: 'build it', updated,
  cost: { total: bucket(1), phases: [{ ...bucket(1), phase: 'build' }], chats: ['x'] }, ...extra,
})
const BOARD = {
  generated: 1_767_403_930,
  jobs: [
    ...Array.from({ length: 10 }, (_, i) => job(`SITE${i}`, 'WEBSITE', 'active', 1_767_403_900 + i)),
    ...Array.from({ length: 5 }, (_, i) => job(`SEO${i}`, 'SEO', 'active', 1_767_403_890 + i)),
    job('A03', 'CONTENT', 'blocked', 1_767_395_600, { blocked_on: "Human: choose the pilot format", next: 'Human: choose the format' }),
    job('B01', 'CONTENT', 'active', 1_767_395_610, { next: 'Human: approve the local capture' }),
    job('PROPOSAL', 'CONTENTX', 'proposed', 1_767_395_620, { next: 'Gate: sample queue open / Human go' }),
    job('B02', 'STUDIO', 'proposed', 1_767_395_630, { next: 'Human picks (one check)' }),
    job('COVER', 'STUDIO', 'blocked', 1_767_395_640, { next: 'title tests live' }),
    job('REVIEW', 'TOOLS', 'blocked', 1_767_395_650, { next: 'Codex review' }),
    job('STYLE', 'SEO', 'blocked', 1_767_395_660, { blocked_on: 'DESIGN mockup (v1, held for Human) must finish first', next: 'Owner actions: local check' }),
    job('EVENT', 'WEBSITE', 'waiting', 1_767_395_670, { blocked_on: 'Synthetic event: sample_event is absent', next: 'sample event visible' }),
  ],
  chats: [],
  prices: { note: 'API-equivalent cost', as_of: '2026-01-01' },
}
const PANE = { title: 'HQ board', isFocused: false, bodyColumns: 160, placement: 'dock' } as any

async function open($: any, on: any, surface: 'desktop' | 'terminal') {
  const store: Record<string, unknown> = { hqSession: 'hq-1', wire: [] }
  on('store.get', ((_$: any, e: any) => ({ value: store[e.key] })) as any)
  on('store.set', ((_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } }) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('env.get', ((_$: any, e: any) => ({ value: e.name === 'FLEET_ROOT' ? '/x/fleet' : e.name === 'FLEET_BOARD_SCRIPT' ? '/x/fleet_board.py' : '' })) as any)
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify(BOARD), stderr: '' } })) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  mock.clock(on, { now: 1_767_403_930_300 })
  await $.command.run({ command: 'board' })
  return $.ui.mount({ plugin: 'hq-board', surface, component: 'Pane', requestId: 'hq-board', props: PANE })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`every lane is listed up top in Human's order and one press jumps to it on ${surface}`, async ($, on) => {
    const ui = await open($, on, surface)
    const index = (await ui.findAll({ type: 'Button' })).filter((b: any) => String(b.key).startsWith('lane-')).map((b: any) => b.text)
    expect(index).toEqual([
      'CONTENT: 3 open · 1 active · 1 blocked · 2 on you',
      'STUDIO: 2 open · 0 active · 1 blocked · 1 on you',
      'WEBSITE: 11 open · 10 active · 0 blocked',
      'SEO: 6 open · 5 active · 1 blocked · 1 on you',
      'TOOLS: 1 open · 0 active · 1 blocked',
    ])
    expect(await ui.find({ type: 'Text', text: /^▌ CONTENTX/ })).toBeUndefined()

    await ui.press({ key: 'lane-SEO' })
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
    const lanes = texts.filter((t: string) => t.startsWith('▌ '))
    expect(lanes[0]).toMatch(/^▌ SEO {2}6 jobs/)
    expect(await ui.find({ type: 'Text', text: /page 3 of 3/ })).toBeDefined()
    await ui.press({ key: 'lane-CONTENT' })
    expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string).filter((t: string) => t.startsWith('▌ '))[0]).toMatch(/^▌ CONTENT {2}3 jobs/)
    expect(await ui.find({ type: 'Text', text: /page 1 of 3/ })).toBeDefined()
    await ui.press({ key: 'lane-WEBSITE' })
    expect(await ui.find({ type: 'Text', text: /^▌ WEBSITE {2}11 jobs/ })).toBeDefined()
    await ui.unmount()
  })

  test(`a blocked job says whom it waits on, and the top line counts what waits on Human on ${surface}`, async ($, on) => {
    const ui = await open($, on, surface)
    await ui.press({ key: 'toggle-jobs' })
    expect(await ui.find({ type: 'Text', text: /^\d+ open · \d+ active · \d+ blocked · 4 waiting on you/ })).toBeDefined()
    const you = (await ui.findAll({ type: 'Text', text: /^\s+on YOU\s*$/ }))
    expect(you.length).toBe(3)
    expect(you.every((t: any) => t.props.bold === true && t.props.color === 'redBright')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on you \(blocked\): Human: choose the pilot format/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on you \(active\): Human: approve the local capture/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on you \(proposed\): Human picks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▸ PROPOSAL title.*proposed/ })).toBeDefined()
    const other = await ui.find({ type: 'Text', text: /^\s+on title te…$/ })
    expect(other?.props.color).toBe('yellow')
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on title tests live \(blocked\): title tests live/ })).toBeDefined()

    await ui.press({ key: 'lane-TOOLS' })
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on Codex review \(blocked\): Codex review$/ })).toBeDefined()
    await ui.press({ key: 'lane-SEO' })
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on you \(blocked\): DESIGN mockup \(v1, held for Human\)/ })).toBeDefined()
    await ui.press({ key: 'lane-WEBSITE' })
    expect(await ui.find({ type: 'Text', text: /⏸ waiting on Synthetic event \(waiting\): Synthetic event: sample_event/ })).toBeDefined()
    await ui.unmount()
  })
}
