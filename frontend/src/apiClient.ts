export interface HttpErrorInfo {
  status: number;
  code?: string;
  message: string;
}

export async function parseHttpError(response: Response): Promise<HttpErrorInfo> {
  let payload: unknown;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  const record =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const apiMessage =
    typeof record?.['message'] === 'string'
      ? record['message']
      : typeof record?.['error'] === 'string'
        ? record['error']
        : null;
  const code = typeof record?.['code'] === 'string' ? record['code'] : undefined;
  const fallback = response.statusText || `Request failed with status ${response.status}`;
  return {
    status: response.status,
    ...(code ? { code } : {}),
    message: apiMessage ?? fallback,
  };
}

export function errorMessage(info: HttpErrorInfo): string {
  return info.message;
}

function parseEventData<T>(block: string): T | undefined {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  if (data.length === 0) return undefined;
  const joined = data.join('\n');
  if (joined === '[DONE]') return undefined;
  return JSON.parse(joined) as T;
}

export async function streamSSE<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
  if (!response.body) throw new Error('Streaming response body is unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');

    let boundary = pending.indexOf('\n\n');
    while (boundary !== -1) {
      const block = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const event = parseEventData<T>(block);
      if (event !== undefined) onEvent(event);
      boundary = pending.indexOf('\n\n');
    }

    if (done) break;
  }

  if (pending.trim()) {
    const event = parseEventData<T>(pending);
    if (event !== undefined) onEvent(event);
  }
}
