/** Public kernel/body contract. No Live2D parameter names or provider keys. */
export type EventType = 'text' | 'click' | 'timer' | 'idle';
export type KernelState = 'idle' | 'thinking' | 'responding' | 'paused' | 'error';
export type Result = 'accepted' | 'completed' | 'cancelled' | 'failed' | 'unsupported';
export interface Task { taskId: string; generation: number }
export interface BodyCommand extends Task {
  commandId: string;
  kind: 'text' | 'emotion' | 'gaze' | 'gesture' | 'stop';
  payload: { text?: string; durationMs?: number; name?: string; x?: number; y?: number };
}
export interface BodyReceipt { taskId: string; commandId?: string; status: Result }
export interface BodyCapabilities {
  protocol: 1;
  commands: BodyCommand['kind'][];
  emotion: string[];
  gaze: boolean;
  gestures: string[];
}
export interface BodyAdapter {
  capabilities(): Promise<BodyCapabilities>;
  begin(task: Task): BodyReceipt | Promise<BodyReceipt>;
  execute(command: BodyCommand, signal?: AbortSignal): BodyReceipt | Promise<BodyReceipt>;
  stop(task: Task): BodyReceipt | Promise<BodyReceipt>;
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface TextUsage { inputTokens: number; outputTokens: number; totalTokens: number | null }
export interface TextResult { text: string; model: string; usage: TextUsage | null; limited: boolean; provider: string }
export interface TextProvider {
  stream(request: { messages: ChatMessage[]; signal: AbortSignal; onDelta: (cumulativeText: string) => void }): Promise<TextResult>;
}
