# codex-executor

A TypeScript client library for the [Codex CLI](https://github.com/openai/codex) app-server. Communicates via JSON-RPC 2.0 over stdio with a spawned Codex process.

## Install

```bash
bun add codex-executor
```

## Requirements

- [Bun](https://bun.sh/) runtime
- [Codex CLI](https://github.com/openai/codex) installed and available in PATH

## Usage

```ts
import { createCodexClient } from 'codex-executor';

const client = createCodexClient();

await client.initialize();

const thread = await client.startThread({
  model: 'o4-mini',
  baseInstructions: 'You are a helpful assistant.',
});

const result = await client.startTurn(thread.id, [
  { type: 'text', text: 'Hello!', text_elements: [] },
]);

console.log(result.message);
console.log(result.tokenUsage);

client.kill();
```

## API

### `createCodexClient(options?): CodexClient`

Creates a new Codex client instance.

**Options:**

| Field       | Type     | Description                                   |
| ----------- | -------- | --------------------------------------------- |
| `codexPath` | `string` | Path to the codex binary (default: `"codex"`) |
| `cwd`       | `string` | Working directory for the codex process       |

### `CodexClient`

| Method                       | Returns               | Description                         |
| ---------------------------- | --------------------- | ----------------------------------- |
| `initialize()`               | `Promise<void>`       | Initialize the client connection    |
| `startThread(params?)`       | `Promise<Thread>`     | Start a new conversation thread     |
| `resumeThread(threadId)`     | `Promise<Thread>`     | Resume an existing thread           |
| `startTurn(threadId, input)` | `Promise<TurnResult>` | Send user input and wait for result |
| `kill()`                     | `void`                | Kill the codex process              |

### JSON-RPC Utilities

Low-level JSON-RPC 2.0 helpers are also exported:

```ts
import {
  rpcRequest,
  rpcNotification,
  rpcResponse,
  parseMessage,
} from 'codex-executor';
```

## License

MIT
