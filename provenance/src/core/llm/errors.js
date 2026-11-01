/** Error from a model call. `status` follows HTTP codes (429 busy, 401 bad key, 502 empty answer, ...). */
export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}
