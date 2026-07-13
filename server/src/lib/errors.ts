import type { OpenAIErrorBody } from "@openkey/shared";

// Single error type for the whole server. The gateway must ALWAYS surface
// errors in OpenAI's shape because SDKs parse it; the fields here map 1:1.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly type: string,
    message: string,
    public readonly extra: Partial<OpenAIErrorBody["error"]> = {},
  ) {
    super(message);
    this.name = "AppError";
  }

  toOpenAI(): OpenAIErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.extra.code ?? null,
        param: this.extra.param ?? null,
        ...this.extra,
      },
    };
  }

  static unauthorized(message: string): AppError {
    return new AppError(401, "invalid_request_error", message, { code: "invalid_api_key" });
  }

  static forbidden(message: string, code = "forbidden"): AppError {
    return new AppError(403, "invalid_request_error", message, { code });
  }

  static badRequest(message: string, param?: string): AppError {
    return new AppError(400, "invalid_request_error", message, param ? { param } : {});
  }

  static budgetExceeded(opts: {
    scope: "org" | "team" | "user" | "key";
    limitUsd: number;
    spentUsd: number;
    resetAt: string;
    contact?: string;
  }): AppError {
    return new AppError(
      429,
      "budget_exceeded",
      `Monthly budget for this ${opts.scope} is exhausted. Resets ${opts.resetAt}.`,
      {
        code: "budget_exceeded",
        scope: opts.scope,
        limit: opts.limitUsd,
        spent: opts.spentUsd,
        reset_at: opts.resetAt,
        ...(opts.contact ? { contact: opts.contact } : {}),
      },
    );
  }

  static rateLimited(kind: "rpm" | "tpm", limit: number): AppError {
    return new AppError(429, "rate_limit_exceeded", `Key ${kind.toUpperCase()} limit of ${limit} exceeded.`, {
      code: "rate_limit_exceeded",
    });
  }

  static upstream(status: number, message: string): AppError {
    return new AppError(status >= 500 ? 502 : status, "upstream_error", message, {
      code: "upstream_error",
    });
  }
}
