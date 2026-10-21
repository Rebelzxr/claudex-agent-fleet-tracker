import { expect, mock, test } from 'claude-code/testing'

test('logs an outgoing chat message with its recipient and delivery status', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 6, 19, 12) })
  let saved: any[] | undefined
  on('store.set', ((_$: any, e: any) => { saved = e.value as any[]; return { value: undefined } }) as any)
  on('store.get', ((_$: any, e: any) => ({ value: e.key === 'hqSession' ? 'hq-1' : saved })) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('tool.call', () => ({
    result: 'ok',
    text: 'Message delivered to session <DIRECTOR_SESSION_ID> ("DESIGN DIRECTOR"); its turn has started on it.',
  }) as any)

  await ($.tool.call as any)({ tool: 'SendMessage', to: '<DIRECTOR_SESSION_ID>', message: 'From HQ — <b>hello</b> team' } as any)

  const value = saved
  expect(value?.length).toBe(1)
  expect(value?.[0]?.dir).toBe('out')
  expect(value?.[0]?.who).toBe('DESIGN DIRECTOR')
  expect(value?.[0]?.status).toBe('delivered')
  expect(value?.[0]?.what).toBe('')
})

test('logs a Inbox mailbox file as an outgoing message', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 6, 19, 12) })
  let saved: any[] | undefined
  on('store.set', ((_$: any, e: any) => { saved = e.value as any[]; return { value: undefined } }) as any)
  on('store.get', ((_$: any, e: any) => ({ value: e.key === 'hqSession' ? 'hq-1' : saved })) as any)
  on('session.id', (() => ({ value: 'hq-1' })) as any)
  on('tool.call', () => ({ result: 'ok', text: 'File created' }) as any)

  await ($.tool.call as any)({ tool: 'Write', file_path: '/x/dispatch/inbox/website/SAMPLE-WORK.md', content: 'hi' } as any)

  const value = saved
  expect(value?.[0]?.who).toBe('Inbox (file)')
  expect(value?.[0]?.what).toBe('SAMPLE-WORK.md')
})
