import type { Response } from 'express';

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
}

export function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiErrorBody = {
    code,
    message,
    requestId: (res.locals as { requestId?: string }).requestId ?? ''
  };
  res.status(status).json(body);
}
