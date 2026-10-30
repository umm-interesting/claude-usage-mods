import { atom, read, update } from 'claude-code'
import type { Register, SessionMeasureInput, SessionRateLimit } from 'claude-code'

type Usage = Pick<SessionMeasureInput, 'context' | 'rateLimits'>

const line = atom({ plugin: 'usage-status', key: 'line' } as const, null)

const WINDOW_LABEL: Record<string, string> = {
  five_hour: '5시간',
  seven_day: '주간',
  spend_limit: '지출',
}
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

const pad = (n: number) => String(n).padStart(2, '0')

// 오늘이면 시각만, 아니면 날짜·요일까지: 14:30 / 10/21(화) 09:00
function resetLabel(iso: string, now: Date): string | undefined {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (at.toDateString() === now.toDateString()) return time
  return `${at.getMonth() + 1}/${at.getDate()}(${WEEKDAY[at.getDay()]}) ${time}`
}

function limitPart(r: SessionRateLimit, now: Date): string {
  const head = `${WINDOW_LABEL[r.kind] ?? r.kind} ${r.percentUsed}%`
  const reset = r.resetsAt && resetLabel(r.resetsAt, now)
  return reset ? `${head} · (${reset} 리셋)` : head
}

// 예: 컨텍스트 45% 90.1k/200k │ 5시간 23% · (14:30 리셋) │ 주간 40.5% · (10/21(수) 09:00 리셋)
// OAuth 구독이라 세션 비용($)은 실제 청구액이 아니므로 표시하지 않는다.
export function statusLine({ context, rateLimits }: Usage, now = new Date()): string {
  const used = context.tokens === undefined ? '—' : compact(context.tokens)
  const parts = [`컨텍스트 ${context.percent ?? 0}% ${used}/${compact(context.window)}`]
  for (const r of rateLimits) parts.push(limitPart(r, now))
  return parts.join(' │ ')
}

// $.ui.status는 엔진이 플러그인 이름을 머리말로 붙이므로, 프롬프트 바로 위 band에 한 줄로 그린다.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    $.ui.status(undefined)
    const text = statusLine(await $.session.usage())
    await update($, line, () => text)
    return ran
  })

  // session.measure는 턴이 끝날 때만 온다. 도구 호출은 API 응답 직후에 시작하므로
  // 그때마다 다시 읽어 턴 중에도 응답 단위로 따라간다. 도구 실행은 기다리게 하지 않는다.
  on('tool.call', ($, e, next) => {
    void $.session.usage().then(u => {
      const text = statusLine(u)
      return update($, line, prev => (prev === text ? prev : text))
    }).catch(() => {})
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const text = statusLine(e)
    await update($, line, () => text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // /reload-plugins 뒤에는 session.start 없이 다음 응답까지 비어 있으므로 직접 읽는다.
    const text = (await read($, line)) ?? statusLine(await $.session.usage())
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{text}</Text>
  })
}
