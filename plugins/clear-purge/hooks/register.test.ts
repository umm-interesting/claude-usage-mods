import { expect, test } from 'claude-code/testing'

import { purges, sessionPaths, typedClear } from './register'

test('/clear만 지우고 /new·/reset은 기록을 남긴다', () => {
  expect(purges('/clear')).toBe(true)
  expect(purges('/clear 출시 점검')).toBe(true)
  expect(purges('/new')).toBe(false)
  expect(purges('  /reset ')).toBe(false)
  expect(purges('/clearly')).toBe(false)
  expect(purges(undefined)).toBe(false)
})

test('history.jsonl에서 떠난 세션이 친 원문을 찾는다', () => {
  const id = '35515a69-6521-4116-937e-f2162e94dac2'
  const other = '8c9d0d43-609f-49f1-937e-4029a22b1f91'
  const line = (display: string, sessionId: string) => JSON.stringify({ display, pastedContents: {}, timestamp: 1, project: '/p', sessionId })
  const tail = [line('질문 하나', id), line('/new', other), line('/clear 출시 점검', id), '{깨진 줄', ''].join('\n')
  expect(typedClear(tail, id)).toBe('/clear 출시 점검')
  expect(typedClear(tail, other)).toBe('/new')
  expect(typedClear(line('질문 하나', id), id)).toBe(undefined)
})

test('세션 하나의 흔적만 지운다', () => {
  const id = '03d6dc9c-27b7-43e1-be80-05a9507d98b1'
  const [find, rm] = sessionPaths('/Users/x', id)
  expect(find).toContain(`${id}.jsonl`)
  expect(find?.[1]).toBe('/Users/x/.claude/projects')
  expect(rm).toEqual(['rm', '-rf', `/Users/x/.claude/file-history/${id}`, `/Users/x/.claude/session-env/${id}`])
})
