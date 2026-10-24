import { expect, mock, test } from 'claude-code/testing'

const bucket = (usd: number, out: number, extra: Record<string, unknown> = {}) => ({
  claude: { 'claude': { input: 10, output: out, output_exact: Math.min(out, 25_000), cache_read: 1_000_000, cache_write_5m: 2000, cache_write_1h: 3000, replies: 3 } },
  codex: { runs: 0, input: 0, cached: 0, output: 0, reasoning: 0, total: 0, total_upper: 0, drops: 0 },
  voice_chars: 0,
  active_s: 3600,
  span: [1_767_373_605, 1_767_403_930],
  usd,
  unpriced: 0,
  output_estimated: Math.max(0, out - 25_000),
  basis: out > 25_000 ? { 'own cost-state': 3 } : {},
  ...extra,
})

const chat = (i: number) => ({
  id: `chat${String(i).padStart(4, '0')}-0000`, title: `CHAT ${i}`, total: bucket(60 - i, 1), coordination: bucket(20, 1),
  jobs_usd: 40 - i, jobs: [], has_cost_state: true,
})

const BOARD = {
  generated: 1_767_403_930,
  jobs: [
    {
      id: 'SAMPLE-ARTICLE', title: 'A01 video', lane: 'CONTENT', status: 'active', done: 6, total: 10, next: 'thumbnails',
      cost: {
        total: bucket(12.34, 500_000, { codex: { runs: 11, input: 1, cached: 1, output: 1, reasoning: 0, total: 10_000_000, total_upper: 12_000_000, drops: 1 } }),
        phases: [
          bucket(5.25, 100_000, {
            phase: 'build',
            claude: {
              'claude': { input: 10, output: 100_000, output_exact: 5000, cache_read: 20_000_000, cache_write_5m: 1_000_000, cache_write_1h: 0, replies: 159 },
              'claude-fast': { input: 4, output: 5000, output_exact: 5000, cache_read: 9000, cache_write_5m: 0, cache_write_1h: 100, replies: 2 },
            },
          }),
          bucket(4.50, 200_000, { phase: 'script' }),
        ],
        chats: ['CONTENT DIRECTOR', 'Codex'],
      },
    },
    {
      id: 'SAMPLE-STORY', title: 'STUDIO Paper Planes', lane: 'STUDIO', status: 'active', done: 3, total: 9, next: 'script R2',
      cost: { total: bucket(0.75, 4000), phases: [bucket(0.75, 4000, { phase: 'direction' })], chats: ['STUDIO'] },
    },
  ],
  chats: [
    { ...chat(0), id: '<CONTENT_SESSION_ID>', title: 'CONTENT DIRECTOR', total: bucket(60, 1), coordination: bucket(20, 1), jobs_usd: 40, jobs: ['SAMPLE-ARTICLE'] },
    ...Array.from({ length: 10 }, (_, i) => chat(i + 1)),
    { ...chat(11), total: bucket(0, 1, { usd: 0, unpriced: 2 }), coordination: bucket(0, 1, { usd: 0, unpriced: 2 }), jobs_usd: 0 },
  ],
  prices: { note: 'API-equivalent cost (not billed: Claude Max + Codex plans are subscriptions)', as_of: '2026-01-01' },
  codex_unattributed: { runs: 100, total: 1_000_000_000, total_upper: 1_100_000_000, several_jobs: 8 },
  errors: [{ chat: 'abc', error: 'ValueError' }],
}

const BODY_MARKER = 'HIDDEN_MESSAGE_BODY'
const PANE = { plugin: 'hq-board', component: 'Pane', requestId: 'hq-board', props: { title: 'HQ board', isFocused: false, bodyColumns: 160, placement: 'dock' } }

async function setUp($: any, on: any) {
  const wire = [{ at: 1_767_403_900_000, dir: 'in', who: 'DESIGN DIRECTOR', what: BODY_MARKER, status: 'delivered' }]
  on('env.get', ((_$: any, e: any) => ({ value: e.name === 'FLEET_ROOT' ? '/x/fleet' : e.name === 'FLEET_BOARD_SCRIPT' ? '/x/fleet_board.py' : '' })) as any)
  on('process.run', (() => ({ value: { exitCode: 0, stdout: JSON.stringify(BOARD), stderr: '' } })) as any)
  on('ui.open', (() => ({ value: { isPlaced: true } })) as any)
  on('store.get', ((_$: any, e: any) => ({ value: e.key === 'wire' ? wire : undefined })) as any)
  mock.clock(on, { now: 1_767_403_930_300 })
  await $.command.run({ command: 'board' })
}

test('shows each job cost and time, marks estimates, and expands phases and models on a press', async ($, on) => {
  await setUp($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await ($.ui.mount as any)({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /~\$12\.34/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not priced: Codex\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex 10\.0M–12\.0M \(11 runs, counter dropped 1×: range\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /out ~500k \(25k exact\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.75/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not billed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /voice|tts-vendor/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Codex not tied to a job: 1000\.0M–1100\.0M tokens \(100 turns, 8 naming several jobs\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 chats skipped \(bad data/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /jobs \$40\.00 \+ coordination \$20\.00/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /cache read/ })).toBeUndefined()
    await ui.press({ key: 'phases-SAMPLE-ARTICLE' })
    expect(await ui.find({ type: 'Text', text: /^\s*build/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\$5\.25/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude: in 10 · out ~500k \(25k exact\) · cache read 1\.0M · write 5m 2k \/ 1h 3k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /estimate basis: own cost-state ×3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude: in 10 · out ~100k \(5k exact\) · cache read 20\.0M · write 5m 1\.0M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fast: in 4 · out 5k · cache read 9k · write 5m 0 \/ 1h 100 · 2 replies/ })).toBeDefined()
    await ui.press({ key: 'phases-SAMPLE-ARTICLE' })
    await ui.unmount()
  }
})

test('lists the top 10 chats and all of them on a press', async ($, on) => {
  await setUp($, on)
  const ui = await ($.ui.mount as any)({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /CHAT 9\b/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CHAT 11\b/ })).toBeUndefined()
  await ui.press({ key: 'toggle-chats' })
  expect(await ui.find({ type: 'Text', text: /CHAT 11\b.*\$0\.00.*not priced: 2 Claude replies/ })).toBeDefined()
  await ui.unmount()
})

test('never draws message text in the pane, only who, direction, status and time', async ($, on) => {
  await setUp($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await ($.ui.mount as any)({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /DESIGN DIRECTOR/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(BODY_MARKER) })).toBeUndefined()
    await ui.unmount()
  }
})
