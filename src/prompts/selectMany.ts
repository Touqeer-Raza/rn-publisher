import { checkbox } from '@inquirer/prompts';

import { isPromptCancel, PublishError } from '../util/errors.js';

export interface CheckboxChoice<T extends string> {
  name: string;
  value: T;
  checked?: boolean;
  disabled?: boolean | string;
}

export async function selectMany<T extends string>(
  message: string,
  choices: CheckboxChoice<T>[],
): Promise<T[]> {
  const enabled = choices.filter((choice) => !choice.disabled);
  if (enabled.length === 0) {
    throw new PublishError(
      `${message}: no destinations are available.`,
      'Enable platforms in rn-publisher.config.js and install the missing tools (see Available). README → Prerequisites.',
    );
  }

  try {
    return await checkbox<T>({
      message,
      required: true,
      instructions: 'Use arrow keys, <space> to toggle, <enter> to confirm',
      choices,
    });
  } catch (error) {
    if (isPromptCancel(error)) {
      throw new PublishError('Cancelled.', 'Run `rn-publisher` again when you are ready.');
    }
    throw error;
  }
}
