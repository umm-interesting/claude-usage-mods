export type UsageLine = string | null

declare module 'claude-code' {
  interface PluginState {
    'usage-status': { line: UsageLine }
  }
}
