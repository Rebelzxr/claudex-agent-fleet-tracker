export type WireEntry = { at: number; dir: 'in' | 'out'; who: string; what: string; status?: string }

export type ModelTokens = {
  input: number
  output: number
  output_exact: number
  cache_read: number
  cache_write_5m: number
  cache_write_1h: number
  replies: number
}

export type CodexTokens = { runs: number; input: number; cached: number; output: number; reasoning: number; total: number; total_upper?: number; drops?: number }

/** One bucket of the ledger: a job, a job's phase, a chat, or a chat's coordination row. */
export type CostBucket = {
  claude: Record<string, ModelTokens>
  codex: CodexTokens
  voice_chars: number
  active_s: number
  span: [number | null, number | null]
  usd: number
  unpriced: number
  /** Output tokens in this bucket that are estimated, not measured. */
  output_estimated?: number
  /** How the estimated replies were calibrated, with counts. */
  basis?: Record<string, number>
  phase?: string
}

export type JobCost = { total: CostBucket; phases: CostBucket[]; chats: string[] }

export type ChatCost = {
  id: string
  title: string
  total: CostBucket
  coordination: CostBucket
  jobs_usd: number
  jobs: string[]
  has_cost_state: boolean
  unlogged_usd?: number
  /** Part of Claude Code's own total that comes from an earlier transcript (resume / fork / before the cutoff). */
  earlier_usd?: number
  copied_replies?: number
}

export type BoardJob = {
  id: string
  title?: string
  lane?: string
  status?: string
  done?: number
  total?: number
  next?: string | null
  /** The card's own `blocked_on` (or `blocker`): what the job waits for, in words. */
  blocked_on?: string | null
  cost?: JobCost | null
  started?: number | null
  updated?: number | null
  error?: string
}

export type Prices = { as_of?: string; sources?: string[]; note: string }

export type Board = {
  timezone?: string | null
  generated: number
  jobs: BoardJob[]
  chats?: ChatCost[]
  prices?: Prices
  codex_unattributed?: { runs: number; total: number; total_upper: number; several_jobs: number }
  errors?: { chat: string; error: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'hq-board': {
      wire: WireEntry[]
      board: Board | null
      /** The one job whose phases are open (at most one id). */
      expanded: string[]
      showDone: boolean
      allChats: boolean
      allJobs: boolean
      /** 0-based page of the "all jobs" and "all chats" views. */
      jobsPage: number
      chatsPage: number
    }
  }
}
