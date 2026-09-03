import { select } from '@inquirer/prompts';

import { isPromptCancel, PublishError } from '../util/errors.js';

export interface SelectChoice<T extends string> {
  name: string;
  value: T;
  description?: string;
  disabled?: boolean | string;
}

export async function selectOne<T extends string>(
  message: string,
  choices: SelectChoice<T>[],
): Promise<T> {
  const enabled = choices.filter((choice) => !choice.disabled);
  if (enabled.length === 0) {
    throw new PublishError(
      `${message}: no choices available.`,
      'Fix the issues listed under Available, then run the command again.',
    );
  }

  try {
    return await select<T>({
      message,
      choices,
    });
  } catch (error) {
    if (isPromptCancel(error)) {
      throw new PublishError('Cancelled.', 'Run `rn-publisher` again when you are ready.');
    }
    throw error;
  }
}
