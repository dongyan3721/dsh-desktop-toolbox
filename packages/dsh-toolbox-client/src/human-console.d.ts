export interface HumanConsoleTransport {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  dispose(): void;
}

export function createHumanConsoleTransport(connection: {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  };
}): HumanConsoleTransport;
