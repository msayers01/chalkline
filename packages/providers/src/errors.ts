/**
 * A provider call that failed. Carries a stable code and whether a retry can
 * help; never the request or response content (logs carry ids only).
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: 'mathpix' | 'anthropic' | 'recorded',
    readonly code: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(`${provider}: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
  }
}
