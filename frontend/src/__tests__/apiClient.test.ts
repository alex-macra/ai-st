import { describe, expect, it } from 'vitest';
import { parseHttpError, streamSSE } from '../apiClient';

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

describe('local API client', () => {
  it('parses structured and non-JSON HTTP errors without exposing response bodies', async () => {
    await expect(
      parseHttpError(
        new Response(
          JSON.stringify({
            code: 'INVALID_UPLOAD',
            message: 'Upload rejected',
          }),
          { status: 415 },
        ),
      ),
    ).resolves.toEqual({
      status: 415,
      code: 'INVALID_UPLOAD',
      message: 'Upload rejected',
    });

    await expect(
      parseHttpError(
        new Response('gateway response', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      ),
    ).resolves.toEqual({ status: 502, message: 'Bad Gateway' });
  });

  it('parses SSE events split across arbitrary chunks and ignores the done sentinel', async () => {
    const events: Array<{ type: string; value?: number }> = [];
    const response = streamingResponse([
      'data: {"type":"progress",',
      '"value":1}\r\n\r\ndata: [DONE]\n\n',
      'data: {"type":"done"}',
    ]);

    await streamSSE<{ type: string; value?: number }>(response, (event) => events.push(event));

    expect(events).toEqual([{ type: 'progress', value: 1 }, { type: 'done' }]);
  });

  it('fails clearly when a response cannot be streamed', async () => {
    await expect(streamSSE(new Response(null), () => undefined)).rejects.toThrow(/unavailable/);
  });
});
