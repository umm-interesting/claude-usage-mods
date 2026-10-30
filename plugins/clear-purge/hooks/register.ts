import type { Register } from 'claude-code'

// /clear는 원래대로 새 세션을 열고, 떠난 세션의 흔적은 디스크에서 지운다.
// 그래야 /resume 목록에 /clear로 버린 대화가 쌓이지 않는다.
//
// /new·/reset은 /clear의 별칭이라 command.run에서는 셋 다 'clear'로 온다.
// prompt.submit은 슬래시 명령에는 오지 않으므로, 입력 원문은 ~/.claude/history.jsonl에서 읽는다.
// 그 줄은 명령이 끝난 직후(0.2초 안팎)에 써지므로 잠깐 기다린다.
// 원문을 끝내 못 찾으면 지우지 않는다 — 기록은 남기는 쪽이 안전하다.

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CLEAR_FAMILY = /^\/(clear|new|reset)(\s|$)/

export function purges(typed: string | undefined): boolean {
  return typed !== undefined && /^\/clear(\s|$)/.test(typed.trim())
}

// history.jsonl 끝부분에서 그 세션이 마지막으로 친 /clear·/new·/reset 원문
export function typedClear(historyTail: string, id: string): string | undefined {
  let found: string | undefined
  for (const line of historyTail.split('\n')) {
    if (!line.includes(id)) continue
    try {
      const entry = JSON.parse(line)
      if (entry.sessionId === id && typeof entry.display === 'string' && CLEAR_FAMILY.test(entry.display.trim())) {
        found = entry.display
      }
    } catch {}
  }
  return found
}

// 세션 하나가 남기는 것: 대화 기록(.jsonl)과 그 부속 폴더, 파일 편집 이력, 세션 환경
export function sessionPaths(home: string, id: string): string[][] {
  const root = `${home}/.claude`
  return [
    ['find', `${root}/projects`, '-maxdepth', '2', '(', '-name', `${id}.jsonl`, '-o', '-name', id, ')',
      '-exec', 'rm', '-rf', '{}', '+'],
    ['rm', '-rf', `${root}/file-history/${id}`, `${root}/session-env/${id}`],
  ]
}

export const register: Register = on => {
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)

    const old = await $.session.id()
    const ran = await next(e)
    const home = await $.env.get('HOME')
    if (!home || !SESSION_ID.test(old) || old === (await $.session.id())) return ran

    let typed: string | undefined
    for (let i = 0; i < 10 && typed === undefined; i++) {
      const tail = await $.process.run(['sh', '-c', 'sleep 0.2; tail -n 50 "$1"', 'sh', `${home}/.claude/history.jsonl`])
      typed = typedClear(tail.stdout, old)
    }
    if (!purges(typed)) return ran

    for (const argv of sessionPaths(home, old)) {
      const r = await $.process.run(argv)
      if (r.exitCode !== 0) $.ui.toast(`clear-purge: ${old} 삭제 실패: ${r.stderr.slice(0, 120)}`)
    }
    return ran
  })
}
