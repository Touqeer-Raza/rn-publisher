import { confirm as inquirerConfirm } from '@inquirer/prompts';

import { isPromptCancel, PublishError } from '../util/errors.js';

export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  try {
    return await inquirerConfirm({
      message,
      default: defaultValue,
    });
  } catch (error) {
    if (isPromptCancel(error)) {
      throw new PublishError('Cancelled.', 'Run `rn-publisher` again when you are ready.');
    }
    throw error;
  }
}
