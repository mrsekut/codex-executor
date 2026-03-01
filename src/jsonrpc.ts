/**
 * JSON-RPC 2.0 protocol utilities for Codex app-server communication.
 */

let nextId = 0;

export function rpcRequest(
  method: string,
  params: Record<string, unknown> = {},
): { id: number; payload: string } {
  const id = ++nextId;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return { id, payload };
}

export function rpcNotification(
  method: string,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

export function rpcResponse(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

// --- Message parsing ---

export type ParsedMessage =
  | { kind: 'response'; id: number; result: unknown }
  | {
      kind: 'error-response';
      id: number;
      error: { code: number; message: string };
    }
  | { kind: 'server-request'; id: number; method: string; params: unknown }
  | { kind: 'notification'; method: string; params: unknown };

export function parseMessage(raw: unknown): ParsedMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;

  // Response (has id + result)
  if ('id' in msg && 'result' in msg) {
    return {
      kind: 'response',
      id: msg['id'] as number,
      result: msg['result'],
    };
  }

  // Error response (has id + error)
  if ('id' in msg && 'error' in msg) {
    return {
      kind: 'error-response',
      id: msg['id'] as number,
      error: msg['error'] as { code: number; message: string },
    };
  }

  // Server request (has id + method)
  if ('id' in msg && 'method' in msg) {
    return {
      kind: 'server-request',
      id: msg['id'] as number,
      method: msg['method'] as string,
      params: msg['params'],
    };
  }

  // Notification (has method, no id)
  if ('method' in msg && !('id' in msg)) {
    return {
      kind: 'notification',
      method: msg['method'] as string,
      params: msg['params'],
    };
  }

  return null;
}
