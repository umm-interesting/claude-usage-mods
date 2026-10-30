import { expect, test } from 'claude-code/testing'

const measured = {
  context: { tokens: 79_000, window: 1_000_000, percent: 8 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 7 }],
  changed: ['context' as const],
}

test('프롬프트 위 band에 머리말 없이 한 줄로 그린다', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, () => h('Text', {}, 'engine') as never)
  await $.session.measure(measured)
  const tree = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false },
  } as never)
  expect(JSON.stringify(tree)).toContain('컨텍스트 8% 79.0k/1.0M │ 5시간 7%')
})

test('설문이 band를 쓰면 비켜 준다', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'AbovePrompt' }, () => h('Text', {}, 'engine') as never)
  await $.session.measure(measured)
  const tree = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: true, isWorking: false },
  } as never)
  expect(JSON.stringify(tree)).not.toContain('컨텍스트')
})

test('턴 중 도구 호출마다 컨텍스트를 다시 읽는다', async ($, on) => {
  let tokens = 100_000
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) }, rateLimits: [] },
  }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => h('Text', {}, 'engine') as never)
  const draw = async () => JSON.stringify(await $.ui.render({
    component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, isWorking: true },
  } as never))

  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 50_000, window: 1_000_000, percent: 5 }, rateLimits: [], changed: ['context'] })
  expect(await draw()).toContain('컨텍스트 5% 50.0k/1.0M')

  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(await draw()).toContain('컨텍스트 10% 100k/1.0M')
  tokens = 250_000
  await $.tool.call({ tool: 'Bash', input: { command: 'true' } } as never)
  expect(await draw()).toContain('컨텍스트 25% 250k/1.0M')
})
