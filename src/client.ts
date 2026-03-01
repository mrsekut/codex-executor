/**
 * Codex app-server client.
 * Communicates via JSON-RPC 2.0 over stdio with a spawned codex process.
 */

import {
  rpcRequest,
  rpcNotification,
  rpcResponse,
  parseMessage,
} from './jsonrpc';
import type {
  CodexClient,
  CodexClientOptions,
  Thread,
  ThreadStartParams,
  TokenUsage,
  TurnResult,
  UserInput,
} from './types';

const DEFAULT_CODEX_PATH = 'codex';

/** @internal Process interface for dependency injection in tests */
export type CodexProcess = {
  stdin: { write(data: string | Uint8Array): unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export function createCodexClient(
  options: CodexClientOptions & { _process?: CodexProcess } = {},
): CodexClient {
  return new CodexClientImpl(options);
}

class CodexClientImpl implements CodexClient {
  private proc: CodexProcess;
  private isExternalProcess: boolean;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private lastTokenUsage: TokenUsage | null = null;
  private lastAgentMessage: string | null = null;
  private turnResolve: ((result: TurnResult) => void) | null = null;

  constructor(options: CodexClientOptions & { _process?: CodexProcess } = {}) {
    const codexPath = options.codexPath ?? DEFAULT_CODEX_PATH;
    const cwd = options.cwd;
    this.isExternalProcess = options._process != null;

    this.proc =
      options._process ??
      Bun.spawn([codexPath, 'app-server'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        ...(cwd ? { cwd } : {}),
      });

    this.startStderrLoop();
    this.startStdoutLoop();
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'codex-executor', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    if (!this.isExternalProcess) {
      await Bun.sleep(500);
    }
  }

  async startThread(params?: ThreadStartParams): Promise<Thread> {
    const threadParams: Record<string, unknown> = {};
    if (params?.cwd) threadParams['cwd'] = params.cwd;
    if (params?.model) threadParams['model'] = params.model;
    if (params?.baseInstructions)
      threadParams['baseInstructions'] = params.baseInstructions;

    const result = (await this.request('thread/start', threadParams)) as Record<
      string,
      unknown
    >;
    const thread = result['thread'] as Record<string, unknown>;
    return { id: thread['id'] as string };
  }

  async resumeThread(threadId: string): Promise<Thread> {
    const result = (await this.request('thread/resume', {
      threadId,
    })) as Record<string, unknown>;
    const thread = result['thread'] as Record<string, unknown>;
    return { id: thread['id'] as string };
  }

  async startTurn(threadId: string, input: UserInput[]): Promise<TurnResult> {
    this.lastTokenUsage = null;
    this.lastAgentMessage = null;

    const turnPromise = new Promise<TurnResult>(resolve => {
      this.turnResolve = resolve;
    });

    await this.request('turn/start', { threadId, input });

    return turnPromise;
  }

  kill(): void {
    this.proc.kill();
  }

  // --- Private methods ---

  private send(data: string): void {
    this.proc.stdin.write(data + '\n');
  }

  private request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    const id = ++this.nextId;
    const payload = rpcRequest(id, method, params);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(payload);
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    this.send(rpcNotification(method, params));
  }

  private handleServerRequest(
    id: number,
    method: string,
    _params: unknown,
  ): void {
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'execCommandApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'applyPatchApproval'
    ) {
      this.send(rpcResponse(id, { decision: 'accept' }));
    } else if (method === 'item/tool/call') {
      this.send(
        rpcResponse(id, { output: 'No handler registered', success: false }),
      );
    } else {
      this.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }),
      );
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const p = params as Record<string, unknown> | undefined;

    if (method === 'turn/completed') {
      const turn = p?.['turn'] as Record<string, unknown> | undefined;
      const status = turn?.['status'] as string | undefined;
      const error = turn?.['error'] as
        | Record<string, unknown>
        | null
        | undefined;

      if (this.turnResolve) {
        this.turnResolve({
          success: status === 'completed',
          message: this.lastAgentMessage,
          tokenUsage: this.lastTokenUsage,
          error: error
            ? ((error['message'] as string) ?? 'Unknown error')
            : null,
        });
        this.turnResolve = null;
      }
    } else if (method === 'thread/tokenUsage/updated') {
      const usage = p?.['tokenUsage'] as Record<string, unknown> | undefined;
      const total = usage?.['total'] as Record<string, unknown> | undefined;
      if (total) {
        this.lastTokenUsage = {
          totalTokens: total['totalTokens'] as number,
          inputTokens: total['inputTokens'] as number,
          outputTokens: total['outputTokens'] as number,
        };
      }
    } else if (method === 'codex/event/task_complete') {
      const msg = p?.['msg'] as Record<string, unknown> | undefined;
      this.lastAgentMessage = (msg?.['last_agent_message'] as string) ?? null;
    }
  }

  private startStderrLoop(): void {
    (async () => {
      const reader = this.proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (!text.includes('failed to refresh available models')) {
            process.stderr.write(`[codex] ${text}`);
          }
        }
      } catch {
        // process exited
      }
    })();
  }

  private startStdoutLoop(): void {
    (async () => {
      const reader = this.proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIdx).trim();
            this.buffer = this.buffer.slice(newlineIdx + 1);
            if (!line) continue;

            try {
              const raw = JSON.parse(line) as unknown;
              const msg = parseMessage(raw);
              if (!msg) continue;

              switch (msg.kind) {
                case 'response': {
                  const p = this.pending.get(msg.id);
                  if (p) {
                    p.resolve(msg.result);
                    this.pending.delete(msg.id);
                  }
                  break;
                }
                case 'error-response': {
                  const p = this.pending.get(msg.id);
                  if (p) {
                    p.reject(new Error(msg.error.message));
                    this.pending.delete(msg.id);
                  }
                  break;
                }
                case 'server-request':
                  this.handleServerRequest(msg.id, msg.method, msg.params);
                  break;
                case 'notification':
                  this.handleNotification(msg.method, msg.params);
                  break;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
      } catch {
        // process exited
      }
    })();
  }
}
