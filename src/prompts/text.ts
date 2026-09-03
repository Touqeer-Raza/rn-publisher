import { input } from '@inquirer/prompts';

import { isPromptCancel, PublishError } from '../util/errors.js';

export type TextValidate = (value: string) => true | string | Promise<true | string>;

export async function text(
  message: string,
  defaultValue?: string,
  validate?: TextValidate,
): Promise<string> {
  try {
    return await input({
      message,
      default: defaultValue,
      validate: validate
        ? async (value) => {
            const result = await validate(value);
            return result;
          }
        : undefined,
    });
  } catch (error) {
    if (isPromptCancel(error)) {
      throw new PublishError('Cancelled.', 'Run `rn-publisher` again when you are ready.');
    }
    throw error;
  }
}
