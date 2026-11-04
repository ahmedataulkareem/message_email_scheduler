declare module "sns-validator" {
  export default class MessageValidator {
    validate(message: unknown, callback: (err: Error | null, message?: unknown) => void): void;
  }
}
