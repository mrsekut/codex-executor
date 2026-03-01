/**
 * Type definitions for Codex app-server client.
 */

export type CodexClientOptions = {
  /** Path to the codex binary (default: "codex") */
  codexPath?: string;

  /** Working directory for the codex process */
  cwd?: string;
};

export type ThreadStartParams = {
  /** Override working directory for this thread */
  cwd?: string;

  /** Override model */
  model?: string;

  /** Base instructions (system prompt) */
  baseInstructions?: string;
};

export type Thread = {
  id: string;
};

export type TurnResult = {
  success: boolean;
  message: string | null;
  tokenUsage: TokenUsage | null;
  error: string | null;
};

export type TokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export type UserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'skill'; name: string; path: string };

export type CodexClient = {
  initialize(): Promise<void>;
  startThread(params?: ThreadStartParams): Promise<Thread>;
  resumeThread(threadId: string): Promise<Thread>;
  startTurn(threadId: string, input: UserInput[]): Promise<TurnResult>;
  kill(): void;
};
