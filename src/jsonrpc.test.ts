import { test, expect, describe } from 'bun:test';
import {
  rpcRequest,
  rpcNotification,
  rpcResponse,
  parseMessage,
} from './jsonrpc';

describe('rpcRequest', () => {
  test('generates valid JSON-RPC request with given id', () => {
    expect(JSON.parse(rpcRequest(1, 'test/method', { key: 'value' }))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'test/method',
      params: { key: 'value' },
    });
  });

  test('uses the provided id', () => {
    expect(JSON.parse(rpcRequest(99, 'a'))).toEqual({
      jsonrpc: '2.0',
      id: 99,
      method: 'a',
      params: {},
    });
  });

  test('defaults params to empty object', () => {
    expect(JSON.parse(rpcRequest(1, 'no-params'))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'no-params',
      params: {},
    });
  });
});

describe('rpcNotification', () => {
  test('generates notification without id', () => {
    expect(
      JSON.parse(rpcNotification('notify/method', { foo: 'bar' })),
    ).toEqual({
      jsonrpc: '2.0',
      method: 'notify/method',
      params: { foo: 'bar' },
    });
  });

  test('defaults params to empty object', () => {
    expect(JSON.parse(rpcNotification('notify'))).toEqual({
      jsonrpc: '2.0',
      method: 'notify',
      params: {},
    });
  });
});

describe('rpcResponse', () => {
  test('generates valid JSON-RPC response', () => {
    expect(JSON.parse(rpcResponse(42, { status: 'ok' }))).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { status: 'ok' },
    });
  });

  test('handles null result', () => {
    expect(JSON.parse(rpcResponse(1, null))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: null,
    });
  });
});

describe('parseMessage', () => {
  test('parses response (id + result)', () => {
    const msg = parseMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(msg).toEqual({
      kind: 'response',
      id: 1,
      result: { ok: true },
    });
  });

  test('parses error-response (id + error)', () => {
    const msg = parseMessage({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601, message: 'Method not found' },
    });
    expect(msg).toEqual({
      kind: 'error-response',
      id: 2,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  test('parses server-request (id + method)', () => {
    const msg = parseMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'item/tool/call',
      params: { tool: 'search' },
    });
    expect(msg).toEqual({
      kind: 'server-request',
      id: 3,
      method: 'item/tool/call',
      params: { tool: 'search' },
    });
  });

  test('parses notification (method, no id)', () => {
    const msg = parseMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    });
    expect(msg).toEqual({
      kind: 'notification',
      method: 'turn/completed',
      params: { turn: { status: 'completed' } },
    });
  });

  test('returns null for null input', () => {
    expect(parseMessage(null)).toBeNull();
  });

  test('returns null for non-object input', () => {
    expect(parseMessage('string')).toBeNull();
    expect(parseMessage(42)).toBeNull();
    expect(parseMessage(undefined)).toBeNull();
  });

  test('returns null for empty object', () => {
    expect(parseMessage({})).toBeNull();
  });

  test('returns null for object with only unknown keys', () => {
    expect(parseMessage({ foo: 'bar' })).toBeNull();
  });
});
