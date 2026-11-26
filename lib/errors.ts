export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503 = 400,
  ) {
    super(message)
    this.name = "ServiceError"
  }
}
