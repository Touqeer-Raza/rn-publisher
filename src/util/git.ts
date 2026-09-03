import { execa } from 'execa';

export async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', args, {
    cwd,
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { stdout: result.stdout.trim(), exitCode: result.exitCode ?? 1 };
}

export async function gitStatusShort(cwd: string): Promise<string> {
  const { stdout } = await git(['status', '-sb'], cwd);
  return stdout;
}

export async function gitRevParseHead(cwd: string): Promise<string> {
  const { stdout, exitCode } = await git(['rev-parse', 'HEAD'], cwd);
  if (exitCode !== 0) {
    return '';
  }
  return stdout;
}

export async function gitCommitExists(cwd: string, sha: string): Promise<boolean> {
  const { exitCode } = await git(['cat-file', '-e', `${sha}^{commit}`], cwd);
  return exitCode === 0;
}

export async function gitLogSubjects(
  cwd: string,
  range: string | undefined,
  maxCount?: number,
): Promise<string[]> {
  const args = ['log', '--pretty=format:%s'];
  if (maxCount) {
    args.push(`-${maxCount}`);
  }
  if (range) {
    args.push(range);
  }
  const { stdout, exitCode } = await git(args, cwd);
  if (exitCode !== 0 || !stdout) {
    return [];
  }
  return stdout.split('\n').filter(Boolean);
}

export async function gitAddCommit(
  cwd: string,
  files: string[],
  message: string,
): Promise<void> {
  await execa('git', ['add', '--', ...files], { cwd, stdio: 'inherit' });
  await execa('git', ['commit', '-m', message, '--', ...files], {
    cwd,
    stdio: 'inherit',
  });
}
