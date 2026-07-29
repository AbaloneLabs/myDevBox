/**
 * LSP diagnostics module.
 *
 * Barrel for the TypeScript language-server integration. The agent loop uses
 * `TsServerClient` to get real-time TS/JS errors after editing files.
 */

export { TsServerClient } from './tsserver-client.js'
export type { Diagnostic } from './tsserver-client.js'

import { TsServerClient } from './tsserver-client.js'

let _client: TsServerClient | null = null

/** 프로세스 전역 tsserver 싱글톤 (02-C LSP writethrough). */
export function getLspClient(): TsServerClient {
  if (!_client) {
    _client = new TsServerClient()
  }
  return _client
}
