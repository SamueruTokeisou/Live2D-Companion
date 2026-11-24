export class ChatError extends Error {
  constructor(code) { super(code); this.code = code }
}
