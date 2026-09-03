import picocolors from 'picocolors';

export function info(message: string): void {
  console.log(message);
}

export function blank(): void {
  console.log('');
}

export function success(message: string): void {
  console.log(`${picocolors.green('✔')} ${message}`);
}

export function warn(message: string): void {
  console.log(`${picocolors.yellow('⚠')} ${message}`);
}

export function error(message: string): void {
  console.error(`${picocolors.red('✖')} ${message}`);
}

export function suggestion(message: string): void {
  console.error(`${picocolors.cyan('Suggestion:')} ${message}`);
}

export function heading(message: string): void {
  console.log('');
  console.log(picocolors.bold(message));
}

export function printError(err: { message: string; suggestion: string }): void {
  for (const line of err.message.split('\n')) {
    error(line);
  }
  blank();
  for (const line of err.suggestion.split('\n')) {
    suggestion(line);
  }
}

export function banner(lines: string[]): void {
  heading('Available');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  blank();
}
