import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Scope, SessionRow } from '../types'

// 기본 /resume 목록은 mod가 그릴 수 있는 자리가 아니라서, 인자 없는 /resume을 가로채
// 삭제 버튼이 있는 같은 목록을 창으로 띄운다. [기본 목록]은 원래 /resume 화면으로 넘긴다.
// 행마다 [재개]는 /resume <id>를 대신 실행하고, [삭제]는 두 번 눌러야 세션 흔적을 디스크에서 지운다.
// /sessions 로도 같은 창을 연다.

const PANE = 'resume-delete'
const rows = atom({ plugin: 'resume-delete', key: 'rows' } as const, [])
const here = atom({ plugin: 'resume-delete', key: 'here' } as const, '')
const hereCwd = atom({ plugin: 'resume-delete', key: 'hereCwd' } as const, '')
const scope = atom({ plugin: 'resume-delete', key: 'scope' } as const, 'here')
const query = atom({ plugin: 'resume-delete', key: 'query' } as const, '')
const armed = atom({ plugin: 'resume-delete', key: 'armed' } as const, '')
const page = atom({ plugin: 'resume-delete', key: 'page' } as const, 0)
const note = atom({ plugin: 'resume-delete', key: 'note' } as const, '')

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// argv: home, 현재 세션 id, here|all. 현재 세션의 .jsonl이 있는 폴더가 이 프로젝트다.
// 제목은 /rename > 에이전트 이름 > 자동 제목 > 첫 프롬프트 > (session) 순.
const LIST_SCRIPT = String.raw`
import json, os, re, sys
home, cur, mode = sys.argv[1], sys.argv[2], sys.argv[3]
root = os.path.join(home, '.claude', 'projects')
dirs = [os.path.join(root, p) for p in os.listdir(root) if os.path.isdir(os.path.join(root, p))]
here = next((d for d in dirs if os.path.exists(os.path.join(d, cur + '.jsonl'))), '')
here_cwd = ''
if here:
    with open(os.path.join(here, cur + '.jsonl'), 'rb') as fh:
        for line in fh:
            if b'"cwd"' in line:
                try: here_cwd = json.loads(line).get('cwd') or ''
                except ValueError: continue
                if here_cwd: break
NAME = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$')
KEYS = [('custom-title', 'customTitle'), ('agent-name', 'agentName'),
        ('ai-title', 'aiTitle'), ('last-prompt', 'lastPrompt')]
rows = []
for d in (dirs if mode == 'all' else [here] if here else []):
    for n in os.listdir(d):
        if not NAME.match(n) or n[:-6] == cur:
            continue
        f = os.path.join(d, n)
        st = os.stat(f)
        found, first, cwd = {}, None, ''
        with open(f, 'rb') as fh:
            for line in fh:
                if line.startswith(b'{"type":"'):
                    for t, k in KEYS:
                        if line.startswith(('{"type":"%s"' % t).encode()):
                            try: found[t] = json.loads(line).get(k)
                            except ValueError: pass
                            break
                    continue
                if (cwd and first is not None) or b'"type":"user"' not in line:
                    continue
                try: o = json.loads(line)
                except ValueError: continue
                if o.get('type') != 'user' or o.get('isSidechain'):
                    continue
                cwd = cwd or o.get('cwd') or ''
                if first is None and not o.get('isMeta'):
                    c = (o.get('message') or {}).get('content')
                    if isinstance(c, list):
                        c = ' '.join(x.get('text', '') for x in c
                                     if isinstance(x, dict) and x.get('type') == 'text')
                    if isinstance(c, str) and c.strip() and not c.lstrip().startswith('<'):
                        first = c
        title = next((found[t] for t, _ in KEYS if found.get(t)), None) or first or '(session)'
        rows.append({'id': n[:-6], 'dir': d, 'cwd': cwd, 'mtimeMs': int(st.st_mtime * 1000),
                     'bytes': st.st_size, 'title': ' '.join(str(title).split())[:200]})
rows.sort(key=lambda r: -r['mtimeMs'])
print(json.dumps({'here': here, 'hereCwd': here_cwd, 'rows': rows}, ensure_ascii=False))
`

// 세션 하나가 남기는 것: 대화 기록(.jsonl)과 그 부속 폴더, 파일 편집 이력, 세션 환경 (clear-purge와 같은 범위)
export function sessionPaths(home: string, projectDir: string, id: string): string[] {
  return [
    `${projectDir}/${id}.jsonl`,
    `${projectDir}/${id}`,
    `${home}/.claude/file-history/${id}`,
    `${home}/.claude/session-env/${id}`,
  ]
}

export function isDeletable(home: string, projectDir: string, id: string): boolean {
  return SESSION_ID.test(id) && projectDir.startsWith(`${home}/.claude/projects/`) && !projectDir.includes('..')
}

export function matches(row: SessionRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${row.title} ${row.cwd} ${row.id}`.toLowerCase()
  return words.every(w => hay.includes(w))
}

export function ago(mtimeMs: number, now: number): string {
  const min = Math.floor((now - mtimeMs) / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`
  if (min < 60 * 24 * 30) return `${Math.floor(min / 60 / 24)}일 전`
  const d = new Date(mtimeMs)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

async function load($: EngineInterface, mode: Scope): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (!home) return 'HOME을 알 수 없어 세션 폴더를 찾지 못했다.'
  const r = await $.process.run(['python3', '-c', LIST_SCRIPT, home, await $.session.id(), mode], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) return `세션 목록을 읽지 못했다: ${r.stderr.slice(0, 300)}`
  const listed = JSON.parse(r.stdout) as { here: string; hereCwd: string; rows: SessionRow[] }
  await update($, rows, () => listed.rows)
  await update($, here, () => listed.here)
  await update($, hereCwd, () => listed.hereCwd)
  await update($, scope, () => mode)
  await update($, armed, () => '')
  await update($, page, () => 0)
  return undefined
}

async function openList($: EngineInterface) {
  const failed = await load($, 'here')
  if (failed) return { text: failed }
  await update($, query, () => '')
  await update($, note, () => '')
  await $.ui.open({ id: PANE, title: '세션', focus: true, closeOnEscape: true })
  return { text: '세션 목록을 열었다. Esc로 닫는다.' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: '지난 세션 목록: 재개하거나 영구 삭제',
    })
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => openList($))

  // 인자 없는 /resume만 가로챈다. /resume <id>와 다른 플러그인(이 창의 [기본 목록] 포함)이 부른 건 그대로.
  on('command.run', { command: 'resume' }, async ($, e, next) => {
    if (e.args.trim() !== '' || e.origin.kind === 'plugin') return next(e)
    return openList($)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const all = await read($, rows)
    const hereDir = await read($, here)
    const hereFolder = await read($, hereCwd)
    const mode = await read($, scope)
    const q = await read($, query)
    const armedId = await read($, armed)
    const message = await read($, note)
    const list = q ? all.filter(row => matches(row, q)) : all
    const perPage = Math.max(3, (e.viewport?.rows ?? 24) - 6)
    const pages = Math.max(1, Math.ceil(list.length / perPage))
    const at = Math.min(await read($, page), pages - 1)
    const now = Date.now()

    const remove = async (row: SessionRow) => {
      const home = await $.env.get('HOME')
      if (!home || !isDeletable(home, row.dir, row.id)) {
        await update($, note, () => `삭제 거부: ${row.id}`)
        return
      }
      const r = await $.process.run(['rm', '-rf', ...sessionPaths(home, row.dir, row.id)])
      await update($, armed, () => '')
      if (r.exitCode !== 0) {
        await update($, note, () => `삭제 실패: ${r.stderr.slice(0, 200)}`)
        return
      }
      await update($, rows, every => every.filter(one => one.id !== row.id))
      await update($, note, () => `삭제함: ${row.title.slice(0, 60)}`)
    }

    // 다른 프로젝트의 세션은 여기서 이어갈 수 없어서, 기본 /resume처럼 실행 명령을 복사해 준다.
    const resume = async (row: SessionRow, surface: typeof e.surface) => {
      if (row.dir !== hereDir) {
        const cmd = `${row.cwd ? `cd ${quote(row.cwd)} && ` : ''}claude --resume ${row.id}`
        const copied = await $.ui.copy({ text: cmd, surface })
        await update($, note, () => (copied.isCopied ? `복사함: ${cmd}` : `다른 프로젝트 세션: ${cmd}`))
        return
      }
      await $.ui.close({ id: PANE })
      await $.command.run({ command: 'resume', args: row.id })
    }

    const native = async () => {
      await $.ui.close({ id: PANE })
      await $.command.run({ command: 'resume' })
    }

    const switchScope = async () => {
      const failed = await load($, mode === 'all' ? 'here' : 'all')
      if (failed) await update($, note, () => failed)
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {Input && (
            <Input key="search" placeholder="검색… (Enter: 첫 항목 재개)" autoFocus value={q}
              onInput={value => void (update($, query, () => value), update($, page, () => 0))}
              onSubmit={(_, press) => void (list[0] && resume(list[0], press.surface))} />
          )}
          <Button key="scope" dimColor onPress={() => void switchScope()}>
            {mode === 'all' ? '이 폴더만 보기' : '모든 폴더 보기'}
          </Button>
          <Button key="native" dimColor onPress={() => void native()}>기본 목록</Button>
        </Box>
        <Text dimColor wrap="truncate-start">
          {mode === 'all' ? '모든 폴더' : `이 폴더: ${hereFolder || hereDir || '(찾지 못함)'}`} · {list.length}개 · 삭제는 두 번 눌러 확정
        </Text>
        {list.length === 0 && <Text dimColor>{q ? '맞는 세션이 없다.' : '다른 세션이 없다.'}</Text>}
        {list.slice(at * perPage, (at + 1) * perPage).map(row => (
          <Box key={row.id} flexDirection="row" gap={1}>
            <Button key={`resume:${row.id}`} dimColor onPress={press => void resume(row, press.surface)}>
              {row.dir === hereDir ? '재개' : '복사'}
            </Button>
            <Button key={`delete:${row.id}`} variant={armedId === row.id ? 'primary' : undefined}
              onPress={() => void (armedId === row.id ? remove(row) : update($, armed, () => row.id))}>
              {armedId === row.id ? '정말 삭제' : '삭제'}
            </Button>
            <Text dimColor>{ago(row.mtimeMs, now).padStart(6)} {size(row.bytes).padStart(6)}</Text>
            {mode === 'all' && <Text color="cyan">{row.cwd.split('/').pop() || '?'}</Text>}
            <Text wrap="truncate-end">{row.title}</Text>
          </Box>
        ))}
        {pages > 1 && (
          <Box flexDirection="row" gap={1}>
            <Button key="prev" onPress={() => void update($, page, p => Math.max(0, Math.min(p, pages - 1) - 1))}>이전</Button>
            <Text dimColor>{at + 1}/{pages}</Text>
            <Button key="next" onPress={() => void update($, page, p => Math.min(pages - 1, p + 1))}>다음</Button>
          </Box>
        )}
        {message !== '' && <Text color="yellow">{message}</Text>}
      </Box>
    )
  })
}
