export interface OperationOptions {
  confirm?: boolean;
}

export function shouldConfirmOperation(options: OperationOptions = {}): boolean {
  return options.confirm !== false;
}
