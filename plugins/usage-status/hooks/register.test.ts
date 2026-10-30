import { expect, test } from 'claude-code/testing'

import { statusLine } from './register'

const now = new Date(2026, 9, 18, 11, 0)
const local = (...a: [number, number, number, number, number]) => new Date(...a).toISOString()

test('컨텍스트·한도·리셋 시각을 한 줄로, 비용은 빼고', () => {
  expect(
    statusLine(
      {
        context: { tokens: 90_123, window: 200_000, percent: 45 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23, resetsAt: local(2026, 9, 18, 14, 30) },
          { kind: 'seven_day', percentUsed: 40.5, resetsAt: local(2026, 9, 21, 9, 0) },
        ],
      },
      now,
    ),
  ).toBe('컨텍스트 45% 90.1k/200k │ 5시간 23% · (14:30 리셋) │ 주간 40.5% · (10/21(수) 09:00 리셋)')
})

test('리셋 시각이 없으면 퍼센트만', () => {
  expect(
    statusLine({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 7 }] }, now),
  ).toBe('컨텍스트 0% —/200k │ 5시간 7%')
})

test('첫 응답 전에는 토큰이 비어 있다', () => {
  expect(statusLine({ context: { window: 1_000_000 }, rateLimits: [] })).toBe('컨텍스트 0% —/1.0M')
})
