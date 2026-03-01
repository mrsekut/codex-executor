import { test, expect, describe } from 'bun:test';
import {
  rpcRequest,
  rpcNotification,
  rpcResponse,
  parseMessage,
} from './jsonrpc';

describe('rpcRequest', () => {
  test('generates valid JSON-RPC request', () => {
    const { id, payload } = rpcRequest('test/method', { key: 'value' });
    const parsed = JSON.parse(payload);

    expect(parsed['jsonrpc']).toBe('2.0');
    expect(parsed['id']).toBe(id);
    expect(parsed['method']).toBe('test/method');
    expect(parsed['params']).toEqual({ key: 'value' });
  });

  test('increments id on each call', () => {
    const first = rpcRequest('a');
    const second = rpcRequest('b');
    expect(second.id).toBe(first.id + 1);
  });

  test('defaults params to empty object', () => {
    const { payload } = rpcRequest('no-params');
    const parsed = JSON.parse(payload);
    expect(parsed['params']).toEqual({});
  });
});

describe('rpcNotification', () => {
  test('generates notification without id', () => {
    const payload = rpcNotification('notify/method', { foo: 'bar' });
    const parsed = JSON.parse(payload);

    expect(parsed['jsonrpc']).toBe('2.0');
    expect(parsed['method']).toBe('notify/method');
    expect(parsed['params']).toEqual({ foo: 'bar' });
    expect('id' in parsed).toBe(false);
  });

  test('defaults params to empty object', () => {
    const payload = rpcNotification('notify');
    const parsed = JSON.parse(payload);
    expect(parsed['params']).toEqual({});
  });
});

describe('rpcResponse', () => {
  test('generates valid JSON-RPC response', () => {
    const payload = rpcResponse(42, { status: 'ok' });
    const parsed = JSON.parse(payload);

    expect(parsed['jsonrpc']).toBe('2.0');
    expect(parsed['id']).toBe(42);
    expect(parsed['result']).toEqual({ status: 'ok' });
  });

  test('handles null result', () => {
    const payload = rpcResponse(1, null);
    const parsed = JSON.parse(payload);
    expect(parsed['result']).toBeNull();
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
