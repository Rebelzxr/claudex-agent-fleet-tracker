import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, BoardJob, ChatCost, CostBucket, WireEntry } from '../types'

const PANE = 'hq-board'
const STORE_KEY = 'wire'
const MAX_WIRE = 300
// Every state the pane can reach must stay drawable, not only the first one. When a redraw is too big the desktop keeps
// the last tree it could take, but the engine has already released that tree's button handles, so every later press is
// "ui_press not handled" and nothing can shrink the state again (0.1.1 "show all": 94 KB / 1,147 nodes, 17 Oct).
// 28 KB / 330 nodes is known to draw, so jobs and chats page, one job opens at a time, and each draw is held to BUDGET.
// Bytes are counted on the tree as this hook returns it; the desktop's copy runs ~11% larger (bold gains a weight),
// so 24.6 KB here is ~27.4 KB there, under the 27.8 KB known to draw.
export const BUDGET = { bytes: 24600, nodes: 330 }
export const JOB_PAGE = 12
// The default view: the newest open jobs, under their lanes.
const NEWEST = 10
const CHAT_TOP = 10
const CHAT_PAGE = 15
const MAX_MSGS = 8
const MAX_PHASES = 8
const DIAG_MAX = 60
const KEEP_RINGS = 8
// At or above this many columns a job is one row; below it, two (name + status, then the numbers).
const WIDE = 110

const wire = atom({ plugin: 'hq-board', key: 'wire' } as const, [])
const board = atom({ plugin: 'hq-board', key: 'board' } as const, null)
const expanded = atom({ plugin: 'hq-board', key: 'expanded' } as const, [])
const showDone = atom({ plugin: 'hq-board', key: 'showDone' } as const, false)
const allChats = atom({ plugin: 'hq-board', key: 'allChats' } as const, false)
const allJobs = atom({ plugin: 'hq-board', key: 'allJobs' } as const, false)
const jobsPage = atom({ plugin: 'hq-board', key: 'jobsPage' } as const, 0)
const chatsPage = atom({ plugin: 'hq-board', key: 'chatsPage' } as const, 0)

// Set by refreshBoard from the data script. Empty means the host's local zone.
let timeZone: string | undefined
const displayTime = (ms: number): string => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  hour12: false, ...(timeZone ? { timeZone } : {}),
}).format(new Date(ms))
const ago = (ms: number, now: number): string => {
  const m = Math.round((now - ms) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}
const tok = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
/** tok for a table cell: billions as "1.41B" so a column stays six wide. */
const tokCell = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : tok(n))
const usd = (n: number): string => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`
const hours = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`)
const sumModels = (b: CostBucket, f: (m: CostBucket['claude'][string]) => number): number =>
  Object.values(b.claude ?? {}).reduce((n, m) => n + f(m), 0)
const outOf = (b: CostBucket): number => sumModels(b, m => m.output)
const ctxOf = (b: CostBucket): number => sumModels(b, m => m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h)
/** "Claude out 211k · ctx 74M · Codex 2.3M (3 runs)": only non-zero parts. */
export const tokenLine = (b: CostBucket): string => {
  const parts: string[] = []
  const out = outOf(b)
  const exact = sumModels(b, m => m.output_exact)
  const ctx = ctxOf(b)
  if (out || ctx) parts.push(`Claude out ${isEstimated(b) ? `~${tok(out)} (${tok(exact)} exact)` : tok(out)} · ctx ${tok(ctx)}`)
  if (b.codex?.runs) {
    const range = b.codex.drops && (b.codex.total_upper ?? 0) > b.codex.total ? `–${tok(b.codex.total_upper ?? 0)}` : ''
    const drop = b.codex.drops ? `, counter dropped ${b.codex.drops}×: range` : ''
    parts.push(`Codex ${tok(b.codex.total)}${range} (${b.codex.runs} run${b.codex.runs === 1 ? '' : 's'}${drop})`)
  }
  return parts.join(' · ') || 'no usage found'
}
/** True when part of the bucket's output (and so its dollars) is estimated, not measured. */
export const isEstimated = (b: CostBucket): boolean => (b.output_estimated ?? 0) > 0
/** "~$60.59" for an estimate, "$0.34" for measured; "+ partial" notes for what has no price. */
export const money = (b: CostBucket): string => `${isEstimated(b) ? '~' : ''}${usd(b.usd)}`
export const unpricedNote = (b: CostBucket): string => {
  const parts: string[] = []
  if (b.codex?.runs) parts.push('Codex')
  if (b.unpriced) parts.push(`${b.unpriced} Claude replies`)
  return parts.length ? ` (not priced: ${parts.join(', ')})` : ''
}
const basisText = (b: CostBucket): string =>
  Object.entries(b.basis ?? {}).map(([k, n]) => `${k} ×${n}`).join(', ')
/** One line per Claude model: every token category, output marked when estimated. */
const modelLines = (b: CostBucket): string[] =>
  Object.entries(b.claude ?? {}).map(([name, m]) =>
    `${name.replace('claude-', '')}: in ${tok(m.input)} · out ${m.output > m.output_exact ? `~${tok(m.output)} (${tok(m.output_exact)} exact)` : tok(m.output)} · cache read ${tok(m.cache_read)} · write 5m ${tok(m.cache_write_5m)} / 1h ${tok(m.cache_write_1h)} · ${m.replies} replies`)
const spanText = (b: CostBucket): string =>
  b.span?.[0] && b.span?.[1] ? `${displayTime(b.span[0] * 1000)} → ${displayTime(b.span[1] * 1000)}` : ''
const oneLine = (s: string, n = 90): string => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

// ── columns ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Cells are padded strings inside one `mono` Text per row: aligned on the terminal and the desktop alike, and about
// one element per styled cell instead of a Box per cell.

/** Cells a character takes in a monospaced face: CJK and emoji two, combining marks none. */
const cellsOf = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0
  if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || c >= 0x20000) return 2
  return 1
}
/** `s` cut or padded to exactly `w` cells; cut text ends in "…". */
const fit = (s: string, w: number, right = false): string => {
  let used = 0
  let out = ''
  const chars = Array.from(s)
  const total = chars.reduce((n, ch) => n + cellsOf(ch), 0)
  if (total <= w) {
    const pad = ' '.repeat(w - total)
    return right ? pad + s : s + pad
  }
  for (const ch of chars) {
    const n = cellsOf(ch)
    if (used + n > w - 1) break
    out += ch
    used += n
  }
  return out + '…' + ' '.repeat(Math.max(0, w - used - 1))
}

type Style = { bold?: boolean; dimColor?: boolean; color?: string }
type Part = [string, Style?]

const LANE_COLORS: Record<string, string> = {
  CONTENT: 'cyan', STUDIO: 'magenta', DESIGN: 'yellow', WEBSITE: 'blue', SEO: 'green', TOOLS: 'redBright', OPS: 'yellowBright', HQ: 'green',
}
const laneName = (j: BoardJob): string => {
  const lane = (j.lane ?? '').trim().toUpperCase() || 'NO LANE'
  return lane === 'CONTENTX' ? 'CONTENT' : lane
}
const laneColor = (lane: string): string => LANE_COLORS[lane] ?? 'white'
const laneLabel = (lane: string): string => lane
const LANE_ORDER = ['CONTENT', 'STUDIO', 'DESIGN', 'WEBSITE', 'SEO', 'TOOLS', 'OPS', 'HQ']
const STATUS_COLORS: Record<string, string> = {
  active: 'green', live: 'green', waiting: 'yellow', blocked: 'red', 'plan-ready': 'cyan', 'drafts-ready': 'cyan',
  proposed: 'gray', done: 'gray', dropped: 'gray',
}
const statusColor = (st?: string): string => STATUS_COLORS[st ?? ''] ?? 'white'
const barColor = (done: number, total: number): string => {
  const pct = total ? done / total : 0
  return pct >= 0.8 ? 'green' : pct >= 0.4 ? 'yellow' : 'red'
}
const barCell = (done: number, total: number, w: number): string => {
  const filled = total ? Math.max(0, Math.min(w, Math.round((done / total) * w))) : 0
  return `${'█'.repeat(filled)}${'░'.repeat(w - filled)} ${fit(`${done}/${total}`, 5, true)}`
}

type Layout = { wide: boolean; nameW: number; gap: string; barW: number }
const layoutFor = (cols: number): Layout => {
  const wide = cols >= WIDE
  // wide: STATUS 12, PROGRESS 14, COST 8, WORK 6, OUT 6, CTX 6, CODEX 6, RUNS 4, eight 2-cell gaps, "▸ phases" 10.
  return wide
    ? { wide, nameW: Math.min(44, cols - 88), gap: '  ', barW: 8 }
    : { wide, nameW: Math.max(16, Math.min(44, cols - 26)), gap: ' ', barW: 6 }
}

/** The numbers of a bucket as cells, in column order: COST WORK OUT CTX CODEX RUNS. */
const numberCells = (b: CostBucket | null | undefined, g: string): Part[] => {
  if (!b) return [[`${g}${fit('—', 8, true)}${[6, 6, 6, 6, 4].map(w => `${g}${fit('·', w, true)}`).join('')}`, { dimColor: true }]]
  const runs = b.codex?.runs ?? 0
  return [
    [`${g}${fit(money(b), 8, true)}`, { bold: true, color: 'green' }],
    [`${g}${fit(hours(b.active_s), 6, true)}${g}${fit(`${isEstimated(b) ? '~' : ''}${tokCell(outOf(b))}`, 6, true)}`],
    [`${g}${fit(tokCell(ctxOf(b)), 6, true)}`, { bold: true }],
    [`${g}${fit(runs ? tokCell(b.codex.total) : '·', 6, true)}`, runs ? { bold: true, color: 'magenta' } : { dimColor: true }],
    [`${g}${fit(runs ? String(runs) : '·', 4, true)}`, { dimColor: true }],
  ]
}
const headerCells = (l: Layout): { top: string; bottom?: string } => {
  const g = l.gap
  const nums = `${fit('COST', 8, true)}${g}${fit('WORK', 6, true)}${g}${fit('OUT', 6, true)}${g}${fit('CTX', 6, true)}${g}${fit('CODEX', 6, true)}${g}${fit('RUNS', 4, true)}`
  return l.wide
    ? { top: `${fit('  JOB', l.nameW)}${g}${fit('STATUS', 12)}${g}${fit('PROGRESS', l.barW + 6)}${g}${nums}` }
    : { top: `${fit('  JOB', l.nameW)}${g}${fit('STATUS', 12)}`, bottom: `  ${fit('PROGRESS', l.barW + 6)}${g}${nums}` }
}

/** The fine print under a job row, only where its numbers need it: estimates, Codex ranges, unpriced parts. */
const jobNote = (c: CostBucket): string => {
  const parts: string[] = []
  if (isEstimated(c)) parts.push(`Claude out ~${tok(outOf(c))} (${tok(sumModels(c, m => m.output_exact))} exact)`)
  if (c.codex?.drops) parts.push(tokenLine({ ...c, claude: {} }))
  if (!parts.length && !c.unpriced) return ''
  return `~ ${[parts.join(' · '), unpricedNote(c).trim()].filter(Boolean).join(' ')}`
}

type Totals = { jobs: number; usd: number; est: boolean; active_s: number; out: number; ctx: number; codex: number; runs: number }
const totalsOf = (jobs: BoardJob[]): Totals =>
  jobs.reduce((t, j) => {
    const c = j.cost?.total
    if (!c) return { ...t, jobs: t.jobs + 1 }
    return {
      jobs: t.jobs + 1, usd: t.usd + c.usd, est: t.est || isEstimated(c), active_s: t.active_s + c.active_s,
      out: t.out + outOf(c), ctx: t.ctx + ctxOf(c), codex: t.codex + (c.codex?.total ?? 0), runs: t.runs + (c.codex?.runs ?? 0),
    }
  }, { jobs: 0, usd: 0, est: false, active_s: 0, out: 0, ctx: 0, codex: 0, runs: 0 } as Totals)
/** "$123 · 12.3h work · ctx 31.1M · Codex 2.3M in 11 runs", labels dim, numbers bold. */
const totalsParts = (t: Totals): Part[] => [
  [`${t.est ? '~' : ''}${usd(t.usd)}`, { bold: true, color: 'green' }],
  [' · ', { dimColor: true }], [hours(t.active_s), { bold: true }], [' work · Claude out ', { dimColor: true }],
  [tokCell(t.out), { bold: true }], [' · ctx ', { dimColor: true }], [tokCell(t.ctx), { bold: true }],
  ...(t.runs ? [[' · Codex ', { dimColor: true }], [tokCell(t.codex), { bold: true, color: 'magenta' }], [` in ${t.runs} runs`, { dimColor: true }]] as Part[] : []),
]

/** Elements in a tree, counted the way the size budget counts them. */
export const countNodes = (n: unknown): number =>
  Array.isArray(n) ? n.reduce((k: number, x) => k + countNodes(x), 0)
    : n && typeof n === 'object' ? 1 + countNodes((n as { children?: unknown }).children) : 0

/**
 * Should this job be flagged ⚠ on the board?
 * `job.updated` / `job.started` are epoch SECONDS; `nowMs` is epoch MILLISECONDS.
 */
function isStale(job: BoardJob, nowMs: number): boolean {
  // A timestamp alone does not prove a job is stuck.
  return false
}

async function isHq($: EngineInterface): Promise<boolean> {
  return (await $.store.get('hqSession')) === (await $.session.id())
}

async function logOf($: EngineInterface): Promise<WireEntry[]> {
  const saved = await $.store.get(STORE_KEY)
  return Array.isArray(saved) ? (saved as WireEntry[]) : []
}

async function addWire($: EngineInterface, entry: WireEntry) {
  if (!(await isHq($))) return
  const list = [...(await logOf($)), entry].slice(-MAX_WIRE)
  await $.store.set(STORE_KEY, list)
  await update($, wire, () => list)
}

// Each session keeps its own ring under 'diag:<session>' and writes it one entry at a time, so no two writers ever
// read-modify-write the same key (0.1.2 shared one 'diag' key across chats and lost entries). `n` is the order the
// events happened in this process; `at` is read when the event happens, not when its write lands.
let diagQueue: Promise<void> = Promise.resolve()
let diagSeq = 0
/** Last DIAG_MAX open/draw/press events of this session, in the store under 'diag:<session>'. */
function diag($: EngineInterface, step: string, extra: Record<string, unknown> = {}): Promise<void> {
  const n = ++diagSeq
  const at = $.clock.now().catch(() => 0)
  diagQueue = diagQueue.then(async () => {
    const key = `diag:${String((await $.session.id()) ?? '').slice(0, 8)}`
    const prev = await $.store.get(key)
    const list = Array.isArray(prev) ? prev : []
    await $.store.set(key, [...list, { n, at: await at, step, ...extra }].slice(-DIAG_MAX))
  }).catch(() => {})
  return diagQueue
}

/** Keeps the newest KEEP_RINGS sessions' rings; older chats' rings go. */
async function pruneRings($: EngineInterface) {
  const keys = (await $.store.keys()).filter(k => k.startsWith('diag:'))
  if (keys.length <= KEEP_RINGS) return
  const newest = await Promise.all(keys.map(async k => {
    const ring = await $.store.get(k)
    return { k, at: Array.isArray(ring) ? Number(ring[ring.length - 1]?.at ?? 0) : 0 }
  }))
  for (const { k } of newest.sort((a, b) => b.at - a.at).slice(KEEP_RINGS)) await $.store.delete(k)
}

const live = (j: BoardJob) => j.status !== 'done' && j.status !== 'dropped'
/** The jobs the board lists: open ones, plus completed ones when asked for. */
const poolOf = (data: Board | null, withDone: boolean): BoardJob[] =>
  (data?.jobs ?? []).filter(j => withDone || live(j))
const pagesOf = (count: number, size: number): number => Math.max(1, Math.ceil(count / size))
const newestFirst = (a: BoardJob, b: BoardJob) => (b.updated ?? 0) - (a.updated ?? 0)

/** The lanes of `pool` in reading order: LANE_ORDER first, then the rest by their newest job. */
const laneOrderOf = (pool: BoardJob[]): Map<string, number> => {
  const order = new Map<string, number>()
  const seen = [...new Set([...pool].sort(newestFirst).map(laneName))]
  const rank = (lane: string) => (LANE_ORDER.includes(lane) ? LANE_ORDER.indexOf(lane) : LANE_ORDER.length + seen.indexOf(lane))
  for (const lane of [...seen].sort((a, b) => rank(a) - rank(b))) order.set(lane, order.size)
  return order
}
/** `pool` by lane in reading order, newest first within a lane. */
const byLaneOf = (pool: BoardJob[], order: Map<string, number>): BoardJob[] =>
  [...pool].sort((a, b) => (order.get(laneName(a)) ?? 0) - (order.get(laneName(b)) ?? 0) || newestFirst(a, b))
/**
 * The "all jobs by lane" pages: at most JOB_PAGE jobs each, and a lane starts on a fresh page unless it fits in what
 * is left of the current one, so jumping to a lane lands on its header.
 */
const pagesFor = (byLane: BoardJob[]): BoardJob[][] => {
  const pages: BoardJob[][] = []
  let page: BoardJob[] = []
  for (let i = 0; i < byLane.length;) {
    const lane = laneName(byLane[i]!)
    let end = i
    while (end < byLane.length && laneName(byLane[end]!) === lane) end++
    if (page.length > 0 && page.length + (end - i) > JOB_PAGE) { pages.push(page); page = [] }
    for (; i < end; i++) {
      if (page.length === JOB_PAGE) { pages.push(page); page = [] }
      page.push(byLane[i]!)
    }
  }
  if (page.length > 0) pages.push(page)
  return pages.length > 0 ? pages : [[]]
}

const HUMAN_FIRST = /^\s*human\b/i
const HUMAN_HOLDS = /\b(held for|waiting (on|for)|needs) human\b/i
/**
 * Who an open job waits on: 'YOU' when its card's blocker (else its next step) starts with Human, or a blocked job's
 * blocker says it is held for the person; for another blocked or waiting job, the blocker's first words ("Codex review").
 */
export const waitsOn = (j: BoardJob): string | null => {
  if (!live(j)) return null
  const text = (j.blocked_on ?? '').trim() || (j.next ?? '').trim()
  if (!text) return null
  const held = j.status === 'blocked' || j.status === 'waiting'
  if (HUMAN_FIRST.test(text) || (held && HUMAN_HOLDS.test(text))) return 'YOU'
  if (!held) return null
  return text.split(/:|\s\(|\s[—–-]\s|;|,|\s\+\s|\s(?:must|then)\b/)[0]!.trim().slice(0, 30) || 'someone'
}

/** What each of the pane's Buttons does, by its key; run by the ui.press hook with that press's own $. */
async function act($: EngineInterface, key: string) {
  if (key.startsWith('phases-')) {
    const id = key.slice('phases-'.length)
    await update($, expanded, ids => (ids.includes(id) ? [] : [id]))
    return
  }
  const data = await read($, board)
  const withDone = await read($, showDone)
  const pagesWith = (done: boolean) => {
    const pool = poolOf(data, done)
    return pagesFor(byLaneOf(pool, laneOrderOf(pool)))
  }
  const jobPages = pagesWith(withDone).length
  const chatPages = pagesOf((data?.chats ?? []).length, CHAT_PAGE)
  if (key.startsWith('lane-')) {
    const lane = key.slice('lane-'.length)
    const at = pagesWith(withDone).findIndex(page => page.some(j => laneName(j) === lane))
    if (at >= 0) {
      await update($, jobsPage, () => at)
      await update($, allJobs, () => true)
    }
    return
  }
  switch (key) {
    case 'toggle-jobs':
      if (!(await read($, allJobs))) await update($, jobsPage, () => 0)
      await update($, allJobs, () => true)
      return
    case 'jobs-newest':
      await update($, allJobs, () => false)
      return
    case 'jobs-prev':
      await update($, jobsPage, p => Math.max(0, Math.min(p, jobPages - 1) - 1))
      return
    case 'jobs-next':
      await update($, jobsPage, p => Math.min(jobPages - 1, p + 1))
      return
    case 'toggle-done': {
      const pages = pagesWith(!withDone).length
      await update($, showDone, () => !withDone)
      await update($, jobsPage, p => Math.min(p, pages - 1))
      return
    }
    case 'toggle-chats':
      if (!(await read($, allChats))) await update($, chatsPage, () => 0)
      await update($, allChats, () => true)
      return
    case 'chats-top':
      await update($, allChats, () => false)
      return
    case 'chats-prev':
      await update($, chatsPage, p => Math.max(0, Math.min(p, chatPages - 1) - 1))
      return
    case 'chats-next':
      await update($, chatsPage, p => Math.min(chatPages - 1, p + 1))
  }
}

// A Button's handle is minted when the element is built, and the engine keeps a handle alive across redraws only while
// the same element is drawn again. The desktop asks again on every scroll step (0.1.2 lost a click in such a burst,
// 17 Oct 17:54:59), so each Button is built once per surface, key and label and then reused, labels never change
// with state, and its onPress does nothing: the ui.press hook acts on the key, so no reused closure holds old values.
const NOOP = () => {}
const buttons = new Map<string, JSX.Element>()

// Draws are logged when what they drew changed. A redraw that drew the same tree (a scroll step, the focus moving) is
// counted into the next logged draw as `skipped` and `why`, so the ring shows what fired a burst without filling up.
type DrawSeen = { sig: number; props: Record<string, unknown>; skipped: number; why: Record<string, number> }
const lastDraw = new Map<string, DrawSeen>()
const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

async function refreshBoard($: EngineInterface) {
  const root = await $.env.get('FLEET_ROOT')
  const script = await $.env.get('FLEET_BOARD_SCRIPT')
  if (!root || !script) {
    $.ui.toast('hq-board: set FLEET_ROOT and FLEET_BOARD_SCRIPT before starting this app')
    return
  }
  const zone = await $.env.get('FLEET_TIMEZONE')
  const args = ['python3', script, '--root', root, '--timezone', zone || '']
  // Token usage is opt-in: the script reads local Claude Code transcripts only when asked.
  if (/^(1|true|yes)$/i.test((await $.env.get('FLEET_USAGE')) || '')) args.push('--usage')
  const claudeDir = await $.env.get('FLEET_CLAUDE_PROJECTS')
  if (claudeDir) args.push('--claude-dir', claudeDir)
  const codexDir = await $.env.get('FLEET_CODEX_HOME')
  if (codexDir) args.push('--codex-dir', codexDir)
  if (/^(0|false|no)$/i.test((await $.env.get('FLEET_CODEX')) || '')) args.push('--no-codex')
  const codexDays = await $.env.get('FLEET_CODEX_DAYS')
  if (codexDays) args.push('--codex-days', codexDays)
  const ran = await $.process.run(args)
  if (ran.exitCode !== 0) {
    $.ui.toast(`hq-board: calculator failed (${ran.stderr.slice(0, 80)})`)
    return
  }
  try {
    const data = JSON.parse(ran.stdout) as Board
    const zone = data.timezone || undefined
    if (zone) new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format()
    timeZone = zone
    await update($, board, () => data)
  } catch {
    $.ui.toast('hq-board: calculator output was not JSON')
  }
}

async function refreshStatus($: EngineInterface) {
  const u = await $.session.usage()
  const parts: string[] = []
  if (u.context?.percent !== undefined) parts.push(`ctx ${Math.round(u.context.percent)}%`)
  for (const r of u.rateLimits ?? []) {
    const label = r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? 'wk' : r.kind
    parts.push(`${label} ${Math.round(r.percentUsed)}%`)
  }
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
}

/** How much of each section one draw shows; smaller limits are tried when a draw comes out over BUDGET. */
type Limits = { jobs: number; chats: number; msgs: number; detail: boolean }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (!(await $.store.get('hqSession'))) await $.store.set('hqSession', await $.session.id())
    const saved = await logOf($)
    await update($, wire, () => saved)
    await $.command.register({ name: 'board', description: 'HQ board: job progress, cost per job and the message log' })
    await $.command.register({ name: 'board-hq', description: 'Make this chat the HQ (the one that logs messages in and out)' })
    void refreshBoard($)
    void refreshStatus($)
    void pruneRings($).catch(() => {})
    $.clock.every(5 * 60 * 1000, () => refreshBoard($))
    $.clock.every(60 * 1000, () => refreshStatus($))
    return next(e)
  })

  on('command.run', { command: 'board-hq' }, async $ => {
    await $.store.set('hqSession', await $.session.id())
    return { text: 'This chat is now the HQ: messages in and out are logged here.' }
  })

  on('command.run', { command: 'board' }, async $ => {
    await refreshBoard($)
    const saved = await logOf($)
    await update($, wire, () => saved)
    const opened = await $.ui.open({ id: PANE, title: 'HQ board' })
    await diag($, 'open', { opened: opened as any })
    return { text: opened.isPlaced ? 'HQ board opened (refreshes every 5 minutes).' : `HQ board is open but not drawn yet: ${opened.reason}` }
  })

  // Incoming: another chat's message to HQ.
  on('session.receive', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'peer' || kind === 'peer-send-message') {
      const name = 'teammate' in e.origin ? e.origin.teammate : 'another chat'
      await addWire($, { at: await $.clock.now(), dir: 'in', who: name, what: '' })
    }
    return next(e)
  })

  // Outgoing: messages to chats, inbox work orders, reviewer jobs.
  on('tool.call', async ($, e, next) => {
    const call = e as any
    const tool: string = call.tool
    const ran = await next(e)
    const now = await $.clock.now()
    const text = String((ran as any)?.text ?? '')
    if (tool === 'SendMessage' || tool.endsWith('send_message')) {
      const who = /\("([^"]+)"\)/.exec(text)?.[1] ?? String(call.to ?? call.session_id ?? 'chat')
      const status = /queued/i.test(text) ? 'queued' : /delivered/i.test(text) ? 'delivered' : 'sent?'
      await addWire($, { at: now, dir: 'out', who, what: '', status })
    } else if ((tool === 'Write' || tool === 'Edit') && /(?:^|\/)dispatch\/inbox\//.test(String(call.file_path ?? ''))) {
      await addWire($, { at: now, dir: 'out', who: 'Inbox (file)', what: String(call.file_path).split('/').pop() ?? '' })
    } else if (tool === 'Bash' && /codex (exec|queue)/.test(String(call.command ?? ''))) {
      await addWire($, { at: now, dir: 'out', who: 'Codex job', what: '' })
    }
    return ran
  })

  // Every press that reaches the pane does its work here, logged first so the redraw it causes comes after it in the
  // ring. A press on a released handle never gets here (the engine answers "not handled"): the desktop log has those.
  on('ui.press', { plugin: 'hq-board', requestId: PANE }, async ($, e, next) => {
    void diag($, 'press', { key: e.element, surface: e.surface, reached: e.element })
    try {
      await act($, e.element)
    } catch (err) {
      void diag($, 'press-failed', { key: e.element, error: String(err).slice(0, 120) })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const data = await read($, board)
    const open = await read($, expanded)
    const withDone = await read($, showDone)
    const everyChat = await read($, allChats)
    const everyJob = await read($, allJobs)
    const jobsAt = await read($, jobsPage)
    const chatsAt = await read($, chatsPage)
    const log = await read($, wire)
    const now = await $.clock.now()
    const cols = Number((e.props as { bodyColumns?: number })?.bodyColumns) || 100
    const L = layoutFor(cols)
    const g = L.gap

    const pool = poolOf(data, withDone).sort(newestFirst)
    const doneCount = (data?.jobs ?? []).filter(j => !live(j)).length
    // Lanes in order of their newest job; within a lane, newest first.
    const laneOrder = laneOrderOf(pool)
    const byLane = byLaneOf(pool, laneOrder)
    const laneTotals = new Map<string, Totals>()
    for (const lane of laneOrder.keys()) laneTotals.set(lane, totalsOf(pool.filter(j => laneName(j) === lane)))
    const pages = pagesFor(byLane)
    const jobPages = pages.length
    const jobPage = Math.min(Math.max(0, jobsAt), jobPages - 1)
    const pageStart = pages.slice(0, jobPage).reduce((n, page) => n + page.length, 0)
    const waits = new Map(pool.map(j => [j.id, waitsOn(j)] as const))
    const onYou = pool.filter(j => waits.get(j.id) === 'YOU').length
    const chatList: ChatCost[] = data?.chats ?? []
    const chatPages = pagesOf(chatList.length, CHAT_PAGE)
    const chatPage = Math.min(Math.max(0, chatsAt), chatPages - 1)

    const span = (parts: Part[]) => {
      // Neighbouring cells of one style share an element; unstyled ones are bare strings.
      const merged: Part[] = []
      for (const [t, s] of parts) {
        const last = merged[merged.length - 1]
        if (last && JSON.stringify(last[1] ?? {}) === JSON.stringify(s ?? {})) last[0] += t
        else merged.push([t, s])
      }
      return merged.map(([t, s]) => (s ? <Text bold={s.bold} dimColor={s.dimColor} color={s.color}>{t}</Text> : t))
    }
    const row = (parts: Part[]) => <Text mono>{span(parts)}</Text>
    const button = (key: string, label: string): JSX.Element => {
      const id = `${e.surface}\u0000${key}\u0000${label}`
      let made = buttons.get(id)
      if (made === undefined) {
        if (buttons.size > 400) buttons.clear()
        made = <Button key={key} plain dimColor onPress={NOOP}>{label}</Button>
        buttons.set(id, made)
      }
      return made
    }

    const jobRows = (j: BoardJob, lim: Limits) => {
      const c = j.cost?.total
      const isOpen = open.includes(j.id)
      const name: Part = [fit(`${isOpen ? '▾ ' : '▸ '}${isStale(j, now) ? '⚠ ' : ''}${j.title || j.id}`, L.nameW), { bold: live(j), dimColor: !live(j) }]
      const who = waits.get(j.id) ?? null
      const status: Part = who === 'YOU' ? [`${g}${fit('on YOU', 12)}`, { bold: true, color: 'redBright' }]
        : who ? [`${g}${fit(`on ${who}`, 12)}`, { color: 'yellow' }]
        : [`${g}${fit(j.status ?? '—', 12)}`, { color: statusColor(j.status) }]
      const progress: Part = [`${L.wide ? g : '  '}${barCell(j.done ?? 0, j.total ?? 0, L.barW)}`, { color: barColor(j.done ?? 0, j.total ?? 0) }]
      const nums = numberCells(c, g)
      const phases = button(`phases-${j.id}`, c ? 'phases' : 'details')
      const first = L.wide ? [name, status, progress, ...nums] : [name, status]
      const lines = [
        phases ? <Box flexDirection="row">{row([...first, [g]])}{phases}</Box> : row(first),
        ...(L.wide ? [] : [row([progress, ...nums])]),
      ]
      if (who) {
        const why = oneLine((j.blocked_on ?? '').trim() || (j.next ?? ''), 64)
        lines.push(who === 'YOU'
          ? <Text color="redBright">{`  ⏸ waiting on you (${j.status}): ${why}`}</Text>
          : <Text color="yellow" dimColor>{`  ⏸ waiting on ${who} (${j.status}): ${why}`}</Text>)
      }
      const note = c ? jobNote(c) : ''
      if (note) lines.push(<Text dimColor>{`  ${note}`}</Text>)
      if (isOpen && lim.detail) {
        lines.push(<Text dimColor>{`    next: ${j.next ? oneLine(j.next, 160) : '—'} · updated ${j.updated ? displayTime(j.updated * 1000) : '—'}`}</Text>)
        if (j.blocked_on) lines.push(<Text dimColor>{`    blocked on: ${oneLine(j.blocked_on, 160)}`}</Text>)
        lines.push(<Text dimColor>{`    steps: ${j.done ?? 0}/${j.total ?? 0} complete`}</Text>)
        const phases = j.cost?.phases ?? []
        for (const p of phases.slice(0, MAX_PHASES)) {
          lines.push(row([[fit(`    ${p.phase ?? ''}`, L.wide ? L.nameW + 30 : 14), { dimColor: true }], ...numberCells(p, g)]))
          for (const line of modelLines(p)) lines.push(<Text dimColor>{`        ${line}`}</Text>)
        }
        if (phases.length > MAX_PHASES) lines.push(<Text dimColor>{`    +${phases.length - MAX_PHASES} more phases`}</Text>)
        if (c) {
          for (const line of modelLines(c)) lines.push(<Text dimColor>{`    ${line}`}</Text>)
          if (isEstimated(c)) lines.push(<Text dimColor>{`    output estimate basis: ${basisText(c)}`}</Text>)
          lines.push(<Text dimColor>{`    chats: ${(j.cost?.chats ?? []).join(', ')}${spanText(c) ? ` · ${spanText(c)}` : ''}`}</Text>)
        }
      }
      return lines
    }

    const laneHeader = (lane: string, shown: number) => {
      const t = laneTotals.get(lane) ?? totalsOf([])
      return (
        <Text>
          {span([
            [`▌ ${laneLabel(lane)}`, { bold: true, color: laneColor(lane) }],
            [`  ${t.jobs} job${t.jobs === 1 ? '' : 's'}${shown < t.jobs ? ` (${shown} shown)` : ''} · `, { dimColor: true }],
            [`${t.est ? '~' : ''}${usd(t.usd)}`, { bold: true, color: 'green' }],
            [' · ctx ', { dimColor: true }], [tokCell(t.ctx), { bold: true }],
            ...(t.runs ? [[' · Codex ', { dimColor: true }], [`${tokCell(t.codex)} ×${t.runs}`, { bold: true, color: 'magenta' }]] as Part[] : []),
          ])}
        </Text>
      )
    }

    const draw = (lim: Limits) => {
      const shown = everyJob ? (pages[jobPage] ?? []) : pool.slice(0, NEWEST)
      // The newest view groups its jobs under their lanes too, in the lanes' own order.
      const view = (everyJob ? shown : [...shown].sort((a, b) => (laneOrder.get(laneName(a)) ?? 0) - (laneOrder.get(laneName(b)) ?? 0) || newestFirst(a, b))).slice(0, lim.jobs)
      const groups: { lane: string; jobs: BoardJob[] }[] = []
      for (const j of view) {
        const last = groups[groups.length - 1]
        if (last && last.lane === laneName(j)) last.jobs.push(j)
        else groups.push({ lane: laneName(j), jobs: [j] })
      }
      const head = headerCells(L)
      const all = totalsOf(pool)
      const active = pool.filter(j => j.status === 'active').length
      const blocked = pool.filter(j => j.status === 'blocked').length
      const chats = (everyChat ? chatList.slice(chatPage * CHAT_PAGE, chatPage * CHAT_PAGE + CHAT_PAGE) : chatList.slice(0, CHAT_TOP)).slice(0, lim.chats)
      const msgs = [...log].reverse().slice(0, lim.msgs)
      const chatW = Math.max(14, Math.min(34, cols - 46))
      const chatTotal = chatList.reduce((n, c) => n + c.total.usd, 0)
      return (
        <Box flexDirection="column">
          <Text bold color="cyan" size="heading">{`JOBS  `}<Text dimColor size="body">{`${everyJob ? `all ${pool.length} by lane` : `newest ${Math.min(NEWEST, pool.length)} of ${pool.length}`}${withDone ? ` · incl. ${doneCount} done` : ''} · ${data ? `updated ${displayTime(data.generated * 1000)}` : 'loading…'}`}</Text></Text>
          <Text>
            <Text bold>{`${pool.length}`}</Text><Text dimColor>{` ${withDone ? 'jobs' : 'open'} · `}</Text>
            <Text bold color="green">{`${active}`}</Text><Text dimColor>{' active · '}</Text>
            <Text bold color="red">{`${blocked}`}</Text><Text dimColor>{' blocked'}</Text>
            {onYou > 0 && <Text dimColor>{' · '}</Text>}{onYou > 0 && <Text bold color="redBright">{`${onYou} waiting on you`}</Text>}
            <Text>{'   '}</Text>
            {span(totalsParts(all))}
          </Text>
          {laneOrder.size > 1 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {[...laneOrder.keys()].map(lane => {
                const jobs = pool.filter(j => laneName(j) === lane)
                const act = jobs.filter(j => j.status === 'active').length
                const blk = jobs.filter(j => j.status === 'blocked').length
                const you = jobs.filter(j => waits.get(j.id) === 'YOU').length
                return button(`lane-${lane}`, `${laneLabel(lane)}: ${jobs.length} open · ${act} active · ${blk} blocked${you ? ` · ${you} on you` : ''}`)
              })}
            </Box>
          )}
          <Text dimColor size="caption">{`${data?.prices?.note ?? ''}${data?.prices?.as_of ? ` · list prices as of ${data.prices.as_of}` : ''} · ~ estimated · Codex not priced · OUT/CTX Claude tokens`}</Text>
          {pool.length === 0 && <Text dimColor>No active job cards in dispatch/jobs/.</Text>}
          {pool.length > 0 && <Text mono bold dimColor>{head.top}</Text>}
          {pool.length > 0 && head.bottom && <Text mono bold dimColor>{head.bottom}</Text>}
          {groups.map(gr => (
            <Box flexDirection="column" marginTop={1}>
              {laneHeader(gr.lane, gr.jobs.length)}
              {gr.jobs.flatMap(j => jobRows(j, lim))}
            </Box>
          ))}
          {view.length < shown.length && <Text color="yellow">{`${shown.length - view.length} rows hidden to keep the pane drawable: close the open phases to see them`}</Text>}
          {everyJob && (
            <Box flexDirection="row" gap={2} marginTop={1}>
              {button('jobs-prev', '◂ prev')}
              <Text dimColor>{`jobs ${pageStart + 1}–${pageStart + shown.length} of ${byLane.length} · page ${jobPage + 1} of ${jobPages}`}</Text>
              {button('jobs-next', 'next ▸')}
            </Box>
          )}
          <Box flexDirection="row" gap={2} marginTop={everyJob ? 0 : 1}>
            {(everyJob || pool.length > NEWEST) && button('jobs-newest', `newest ${NEWEST}`)}
            {(everyJob || pool.length > NEWEST) && button('toggle-jobs', `all ${pool.length} jobs by lane`)}
            {doneCount > 0 && button('toggle-done', `done jobs (${doneCount})`)}
          </Box>

          <Text bold color="cyan" size="heading">{`CHATS  `}<Text dimColor size="body">{`${chatList.length} chats · `}</Text><Text bold color="green" size="body">{usd(chatTotal)}</Text><Text dimColor size="body">{' · jobs + coordination = chat total'}</Text></Text>
          {chatList.length === 0 && <Text dimColor>No chat totals yet.</Text>}
          {chatList.length > 0 && <Text mono bold dimColor>{`${fit('CHAT', chatW)}${g}${fit('TOTAL', 8, true)}${g}${fit('CTX', 6, true)}${g}${fit('WORK', 6, true)}${g}= JOBS + COORDINATION`}</Text>}
          {chats.map(c => row([
            [fit(c.title, chatW), { bold: true }],
            [`${g}${fit(money(c.total), 8, true)}`, { bold: true, color: 'green' }],
            [`${g}${fit(tokCell(ctxOf(c.total)), 6, true)}`, { bold: true }],
            [`${g}${fit(hours(c.total.active_s), 6, true)}${g}= jobs ${usd(c.jobs_usd)} + coordination ${usd(c.coordination.usd)}${c.unlogged_usd && c.unlogged_usd >= 0.5 ? ` · +${usd(c.unlogged_usd)} unlogged` : ''}${c.earlier_usd && c.earlier_usd >= 0.5 ? ` · +${usd(c.earlier_usd)} earlier` : ''}${c.has_cost_state ? '' : ' · output estimated'}${unpricedNote(c.total)} · ${c.id.slice(0, 6)}`, { dimColor: true }],
          ]))}
          {everyChat && (
            <Box flexDirection="row" gap={2}>
              {button('chats-prev', '◂ prev')}
              <Text dimColor>{`chats ${chatPage * CHAT_PAGE + 1}–${chatPage * CHAT_PAGE + chats.length} of ${chatList.length} · page ${chatPage + 1} of ${chatPages}`}</Text>
              {button('chats-next', 'next ▸')}
            </Box>
          )}
          {chatList.length > CHAT_TOP && (
            <Box flexDirection="row" gap={2}>
              {button('chats-top', `top ${CHAT_TOP}`)}
              {button('toggle-chats', `all ${chatList.length} chats`)}
            </Box>
          )}
          {data?.codex_unattributed?.runs ? (
            <Text dimColor>Codex not tied to a job: {tok(data.codex_unattributed.total)} tokens ({data.codex_unattributed.runs} turns{data.codex_unattributed.several_jobs ? `, ${data.codex_unattributed.several_jobs} naming several jobs` : ''})</Text>
          ) : ''}
          {(data?.errors ?? []).length > 0 && <Text color="red">{(data?.errors ?? []).length} chats skipped (bad data in their transcript)</Text>}

          <Text bold color="cyan" size="heading">{`MESSAGES  `}<Text dimColor size="body">{`${timeZone ?? 'local time'} · newest ${msgs.length} of ${log.length} logged`}</Text></Text>
          {log.length === 0 && <Text dimColor>Nothing logged yet.</Text>}
          {msgs.map(w => row([
            [`${fit(displayTime(w.at), 16)}  `, { bold: true }],
            [`${w.dir === 'in' ? '⬅ ' : '➡ '}${w.who}`, { bold: true, color: w.dir === 'in' ? 'green' : 'yellow' }],
            [`  ${ago(w.at, now)}${w.status ? ` · ${w.status === 'delivered' ? '✓ ' : ''}${w.status}` : ''}`, { dimColor: true }],
          ]))}
        </Box>
      )
    }

    // Draw at full size, then smaller until the tree fits BUDGET: never hand a surface a tree it may not take.
    // What the person just opened (a job's phases) goes last: chats and messages give way first.
    const tries: Limits[] = [
      { jobs: JOB_PAGE, chats: CHAT_PAGE, msgs: MAX_MSGS, detail: true },
      { jobs: JOB_PAGE, chats: CHAT_TOP, msgs: 6, detail: true },
      { jobs: JOB_PAGE, chats: 6, msgs: 6, detail: true },
      { jobs: JOB_PAGE, chats: 5, msgs: 3, detail: true },
      { jobs: 6, chats: 3, msgs: 3, detail: true },
      { jobs: 6, chats: 3, msgs: 3, detail: false },
    ]
    let tree: unknown = null
    let json = ''
    let size = { bytes: 0, nodes: 0 }
    let trim = 0
    for (const [i, lim] of tries.entries()) {
      tree = draw(lim)
      json = JSON.stringify(tree) ?? ''
      size = { bytes: json.length, nodes: countNodes(tree) }
      trim = i
      if (size.bytes <= BUDGET.bytes && size.nodes <= BUDGET.nodes) break
    }
    const p = e.props as { scroll?: { offset?: number; bodyRows?: number }; isFocused?: boolean; placement?: string; view?: { agentId?: string } }
    const props = { scroll: `${p.scroll?.offset ?? ''}/${p.scroll?.bodyRows ?? ''}`, focus: p.isFocused === true, cols, placement: p.placement ?? '', view: p.view?.agentId ?? '' }
    const site = `${e.surface}\u0000${e.requestId}`
    const seen = lastDraw.get(site)
    const changed = seen ? Object.keys(props).filter(k => seen.props[k] !== props[k as keyof typeof props]) : []
    const sig = hash(json)
    if (seen && seen.sig === sig) {
      seen.skipped += 1
      for (const k of changed.length ? changed : ['none']) seen.why[k] = (seen.why[k] ?? 0) + 1
      seen.props = props
    } else {
      lastDraw.set(site, { sig, props, skipped: 0, why: {} })
      // Not awaited: a record of the draw for the ring, never a reason to hold the drawing up.
      void diag($, 'draw', {
        surface: e.surface, cols, bytes: size.bytes, nodes: size.nodes, trim, changed,
        all: everyJob, page: jobPage, of: pool.length, open: open[0] ?? null, chats: everyChat ? `p${chatPage}` : 'top',
        skipped: seen?.skipped ?? 0, why: seen?.why ?? {},
      })
    }
    return tree as any
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const log = await read($, wire)
    const data = await read($, board)
    const lastIn = [...log].reverse().find(w => w.dir === 'in')
    const lastOut = [...log].reverse().find(w => w.dir === 'out')
    const active = (data?.jobs ?? []).filter(j => j.status === 'active').length
    if (!lastIn && !lastOut && !active) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text dimColor>
        {lastIn ? `⬅ ${lastIn.who} ${displayTime(lastIn.at)}` : ''}
        {lastIn && lastOut ? '  ·  ' : ''}
        {lastOut ? `➡ ${lastOut.who} ${displayTime(lastOut.at)}` : ''}
        {active ? `  ·  ${active} active jobs (/board)` : ''}
      </Text>
    )
  })
}
