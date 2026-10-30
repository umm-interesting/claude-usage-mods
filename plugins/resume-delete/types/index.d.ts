export type SessionRow = {
  id: string
  dir: string
  cwd: string
  mtimeMs: number
  bytes: number
  title: string
}

export type Scope = 'here' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'resume-delete': {
      rows: SessionRow[]
      here: string
      hereCwd: string
      scope: Scope
      query: string
      armed: string
      page: number
      note: string
    }
  }
}
