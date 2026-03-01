import { test, expect, describe, afterEach } from 'bun:test';
import { createCodexClient } from './client';
import type { CodexProcess } from './client';
import type { CodexClient } from './types';

// --- Mock helpers ---

type MockCodexProcess = {
  process: CodexProcess;
  sentMessages: unknown[];
  killed: boolean;
  waitForMessage(): Promise<Record<string, unknown>>;
  respond(id: number, result: unknown): void;
  sendErrorResponse(id: number, code: number, message: string): void;
  sendNotification(method: string, params: unknown): void;
  sendServerRequest(id: number, method: string, params: unknown): void;
  close(): void;
};

function createMockCodexProcess(): MockCodexProcess {
  const stdoutTransform = new TransformStream<Uint8Array, Uint8Array>();
  const stdoutWriter = stdoutTransform.writable.getWriter();
  const encoder = new TextEncoder();

  const sentMessages: unknown[] = [];
  const messageQueue: unknown[] = [];
  const messageWaiters: Array<(msg: Record<string, unknown>) => void> = [];

  const stdin = {
    write(data: string | Uint8Array): void {
      const str =
        typeof data === 'string' ? data : new TextDecoder().decode(data);
      for (const line of str.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          sentMessages.push(parsed);
          const waiter = messageWaiters.shift();
          if (waiter) {
            waiter(parsed as Record<string, unknown>);
          } else {
            messageQueue.push(parsed);
          }
        } catch {
          // not JSON
        }
      }
    },
  };

  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

  let killed = false;

  function pushToStdout(obj: unknown): void {
    const line = JSON.stringify(obj) + '\n';
    stdoutWriter.write(encoder.encode(line));
  }

  return {
    process: {
      stdin,
      stdout: stdoutTransform.readable,
      stderr,
      kill() {
        killed = true;
      },
    },
    sentMessages,
    get killed() {
      return killed;
    },
    waitForMessage(): Promise<Record<string, unknown>> {
      const queued = messageQueue.shift();
      if (queued) return Promise.resolve(queued as Record<string, unknown>);
      return new Promise(resolve => {
        messageWaiters.push(resolve);
      });
    },
    respond(id: number, result: unknown): void {
      pushToStdout({ jsonrpc: '2.0', id, result });
    },
    sendErrorResponse(id: number, code: number, message: string): void {
      pushToStdout({ jsonrpc: '2.0', id, error: { code, message } });
    },
    sendNotification(method: string, params: unknown): void {
      pushToStdout({ jsonrpc: '2.0', method, params });
    },
    sendServerRequest(id: number, method: string, params: unknown): void {
      pushToStdout({ jsonrpc: '2.0', id, method, params });
    },
    close(): void {
      stdoutWriter.close();
    },
  };
}

/** Run initialize handshake so client is ready for further operations */
async function initializeClient(
  mock: MockCodexProcess,
  client: CodexClient,
): Promise<void> {
  const initPromise = client.initialize();
  const msg = await mock.waitForMessage();
  mock.respond(msg['id'] as number, {});
  // consume the "initialized" notification
  await mock.waitForMessage();
  await initPromise;
}

// --- Tests ---

let client: CodexClient | null = null;
let mock: MockCodexProcess | null = null;

afterEach(() => {
  if (client) {
    client.kill();
    client = null;
  }
  if (mock) {
    mock.close();
    mock = null;
  }
});

describe('initialize', () => {
  test('sends initialize request with correct params', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });

    const initPromise = client.initialize();
    const msg = await mock.waitForMessage();

    expect(msg).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex-executor', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      },
    });

    mock.respond(1, {});
    const notif = await mock.waitForMessage();

    expect(notif).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {},
    });

    await initPromise;
  });
});

describe('startThread', () => {
  test('returns thread id', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const threadPromise = client.startThread();
    const msg = await mock.waitForMessage();

    expect(msg['method']).toBe('thread/start');
    expect(msg['params']).toEqual({});

    mock.respond(msg['id'] as number, {
      thread: { id: 'thread-123' },
    });

    const thread = await threadPromise;
    expect(thread).toEqual({ id: 'thread-123' });
  });

  test('passes params to thread/start', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const threadPromise = client.startThread({
      cwd: '/tmp',
      model: 'gpt-4',
      baseInstructions: 'Be helpful',
    });
    const msg = await mock.waitForMessage();

    expect(msg['params']).toEqual({
      cwd: '/tmp',
      model: 'gpt-4',
      baseInstructions: 'Be helpful',
    });

    mock.respond(msg['id'] as number, {
      thread: { id: 'thread-456' },
    });
    await threadPromise;
  });
});

describe('resumeThread', () => {
  test('sends thread/resume and returns thread', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const resumePromise = client.resumeThread('thread-existing');
    const msg = await mock.waitForMessage();

    expect(msg['method']).toBe('thread/resume');
    expect(msg['params']).toEqual({ threadId: 'thread-existing' });

    mock.respond(msg['id'] as number, {
      thread: { id: 'thread-existing' },
    });

    const thread = await resumePromise;
    expect(thread).toEqual({ id: 'thread-existing' });
  });
});

describe('startTurn', () => {
  test('resolves with TurnResult on turn/completed', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const turnPromise = client.startTurn('thread-1', [
      { type: 'text', text: 'Hello', text_elements: [] },
    ]);
    const msg = await mock.waitForMessage();

    expect(msg['method']).toBe('turn/start');
    expect(msg['params']).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Hello', text_elements: [] }],
    });

    mock.respond(msg['id'] as number, {});

    mock.sendNotification('turn/completed', {
      turn: { status: 'completed' },
    });

    const result = await turnPromise;
    expect(result).toEqual({
      success: true,
      message: null,
      tokenUsage: null,
      error: null,
    });
  });

  test('collects tokenUsage from notification', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const turnPromise = client.startTurn('thread-1', [
      { type: 'text', text: 'Hello', text_elements: [] },
    ]);
    const msg = await mock.waitForMessage();
    mock.respond(msg['id'] as number, {});

    mock.sendNotification('thread/tokenUsage/updated', {
      tokenUsage: {
        total: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
      },
    });
    mock.sendNotification('turn/completed', {
      turn: { status: 'completed' },
    });

    const result = await turnPromise;
    expect(result.tokenUsage).toEqual({
      totalTokens: 100,
      inputTokens: 80,
      outputTokens: 20,
    });
  });

  test('collects agentMessage from task_complete notification', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const turnPromise = client.startTurn('thread-1', [
      { type: 'text', text: 'Hello', text_elements: [] },
    ]);
    const msg = await mock.waitForMessage();
    mock.respond(msg['id'] as number, {});

    mock.sendNotification('codex/event/task_complete', {
      msg: { last_agent_message: 'Done!' },
    });
    mock.sendNotification('turn/completed', {
      turn: { status: 'completed' },
    });

    const result = await turnPromise;
    expect(result.message).toBe('Done!');
  });

  test('reports error on failed turn', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const turnPromise = client.startTurn('thread-1', [
      { type: 'text', text: 'Hello', text_elements: [] },
    ]);
    const msg = await mock.waitForMessage();
    mock.respond(msg['id'] as number, {});

    mock.sendNotification('turn/completed', {
      turn: { status: 'failed', error: { message: 'Something went wrong' } },
    });

    const result = await turnPromise;
    expect(result).toEqual({
      success: false,
      message: null,
      tokenUsage: null,
      error: 'Something went wrong',
    });
  });
});

describe('server-request auto-approval', () => {
  test('auto-approves commandExecution request', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    mock.sendServerRequest(100, 'item/commandExecution/requestApproval', {
      command: 'ls',
    });

    // Wait for the client to process and respond
    await Bun.sleep(10);

    const approval = mock.sentMessages.find(
      m =>
        (m as Record<string, unknown>)['id'] === 100 &&
        'result' in (m as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;

    expect(approval).toBeDefined();
    expect(approval!['result']).toEqual({ decision: 'accept' });
  });

  test('auto-approves fileChange request', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    mock.sendServerRequest(101, 'item/fileChange/requestApproval', {});

    await Bun.sleep(10);

    const approval = mock.sentMessages.find(
      m =>
        (m as Record<string, unknown>)['id'] === 101 &&
        'result' in (m as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;

    expect(approval).toBeDefined();
    expect(approval!['result']).toEqual({ decision: 'accept' });
  });
});

describe('error-response', () => {
  test('rejects pending request on error response', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });
    await initializeClient(mock, client);

    const threadPromise = client.startThread();
    const msg = await mock.waitForMessage();

    mock.sendErrorResponse(msg['id'] as number, -32600, 'Invalid request');

    await expect(threadPromise).rejects.toThrow('Invalid request');
  });
});

describe('kill', () => {
  test('kills the process', async () => {
    mock = createMockCodexProcess();
    client = createCodexClient({ _process: mock.process });

    expect(mock.killed).toBe(false);
    client.kill();
    expect(mock.killed).toBe(true);
    client = null; // prevent double kill in afterEach
  });
});
