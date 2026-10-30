import { expect, test } from 'claude-code/testing'

import { ago, isDeletable, matches, sessionPaths } from './register'

const HOME = '/Users/x'
const DIR = `${HOME}/.claude/projects/-Users-x`
const OTHER = `${HOME}/.claude/projects/-Users-x-repo`
const A = '03d6dc9c-27b7-43e1-be80-05a9507d98b1'
const B = '7f0e2a11-0000-4000-8000-000000000002'
const PANE = {
  title: '세션', isFocused: true, bodyColumns: 100, placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 20 }, view: {},
}
const ROW_A = { id: A, dir: DIR, cwd: HOME, mtimeMs: 0, bytes: 2048, title: '첫 세션' }
const ROW_B = { id: B, dir: DIR, cwd: HOME, mtimeMs: 0, bytes: 4096, title: '둘째 세션' }
const presentation = { isFullscreen: false, columns: 120 }

test('세션 하나의 흔적만 지운다', () => {
  expect(sessionPaths(HOME, DIR, A)).toEqual([
    `${DIR}/${A}.jsonl`, `${DIR}/${A}`,
    `${HOME}/.claude/file-history/${A}`, `${HOME}/.claude/session-env/${A}`,
  ])
  expect(isDeletable(HOME, DIR, A)).toBe(true)
  expect(isDeletable(HOME, DIR, '../etc')).toBe(false)
  expect(isDeletable(HOME, '/tmp', A)).toBe(false)
  expect(isDeletable(HOME, `${HOME}/.claude/projects/../x`, A)).toBe(false)
})

test('검색은 제목·경로의 모든 단어를 본다', () => {
  expect(matches(ROW_A, '첫')).toBe(true)
  expect(matches(ROW_A, '세션 첫')).toBe(true)
  expect(matches(ROW_A, '둘째')).toBe(false)
  expect(matches({ ...ROW_A, cwd: '/Users/x/repo' }, 'REPO')).toBe(true)
})

test('경과 시간 표시', () => {
  const now = Date.UTC(2026, 9, 4)
  expect(ago(now - 30_000, now)).toBe('방금')
  expect(ago(now - 5 * 60_000, now)).toBe('5분 전')
  expect(ago(now - 3 * 3600_000, now)).toBe('3시간 전')
  expect(ago(now - 2 * 86400_000, now)).toBe('2일 전')
})

test('/resume <id>는 가로채지 않는다', async ($, on) => {
  const reached: string[] = []
  on('command.run', (_, e) => { reached.push(e.args); return { text: 'native' } })
  const r = await $.command.run({ command: 'resume', args: A, origin: { kind: 'composer' }, presentation })
  expect(r.text).toBe('native')
  expect(reached).toEqual([A])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: /resume 창에서 삭제는 두 번 눌러야 지우고, 목록에서 빠진다`, async ($, on) => {
    const ran: string[][] = []
    const opened: string[] = []
    on('env.get', () => ({ value: HOME }))
    on('session.id', () => ({ value: 'ffffffff-0000-4000-8000-000000000000' }))
    on('ui.open', (_, e) => { opened.push(e.id); return { value: { isOpen: true } } as never })
    on('command.run', () => ({ text: 'native' }))
    on('process.run', (_, e) => {
      ran.push([...e.argv])
      const stdout = e.argv[0] === 'python3'
        ? JSON.stringify({ here: DIR, hereCwd: HOME, rows: [{ ...ROW_A, mtimeMs: Date.now() - 60_000 }, { ...ROW_B, dir: OTHER }] })
        : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    const r = await $.command.run({ command: 'resume', args: '', origin: { kind: 'composer' }, presentation })
    expect(r.text).not.toBe('native')
    expect(opened).toEqual(['resume-delete'])

    const ui = await $.ui.mount({
      plugin: 'resume-delete', surface, component: 'Pane', props: PANE, requestId: 'resume-delete',
    })
    expect((await ui.find({ key: `resume:${A}` }))?.text).toContain('재개')
    expect((await ui.find({ key: `resume:${B}` }))?.text).toContain('복사')
    expect(await ui.find({ type: 'Text', text: `이 폴더: ${HOME}` })).toBeDefined()
    expect((await ui.find({ key: 'scope' }))?.text).toContain('모든 폴더 보기')

    await ui.press({ key: `delete:${A}` })
    expect(ran.some(argv => argv[0] === 'rm')).toBe(false)
    expect((await ui.find({ key: `delete:${A}` }))?.text).toContain('정말 삭제')

    await ui.press({ key: `delete:${A}` })
    expect(ran.find(argv => argv[0] === 'rm')).toEqual(['rm', '-rf', ...sessionPaths(HOME, DIR, A)])
    expect(await ui.find({ key: `resume:${A}` })).toBeUndefined()
    expect(await ui.find({ key: `resume:${B}` })).toBeDefined()
  })
}
