import { expect, it } from 'vitest';
import { accountMediaMessages, accountSignInMessages } from '../../../gateway/account.ts';
import { ConnectorUnavailable, type ConnectorProblem } from '../../../gateway/account-connector.ts';
import { isKnownMessage, NON_ENGLISH_LOCALES, translate } from './messages';

// The failure card translates gateway errors by exact text, so a reworded gateway message would silently stay English.
it('has a Chinese translation for every account media failure the gateway reports', () => {
  expect(accountMediaMessages.length).toBeGreaterThan(10);
  expect(accountMediaMessages.filter(message => !isKnownMessage(message))).toEqual([]);
});

it('has a Chinese translation for every sign-in failure the account panel shows', () => {
  expect(accountSignInMessages.length).toBeGreaterThan(5);
  expect(accountSignInMessages.filter(message => !isKnownMessage(message))).toEqual([]);
});

const preparationErrors: [ConnectorProblem, Error][] = [
  ['start_failed', Object.assign(new Error(), { code: 'EACCES' })],
  ['install_timeout', Object.assign(new Error(), { killed: true })],
  ['start_failed', Object.assign(new Error(), { code: 'ETIMEDOUT' })],
  ['start_failed', new Error('Vela CLI is not packaged for this platform')],
];

it.each(preparationErrors)('localizes the recovery advice for %s across all Studio languages', (problem, error) => {
  const { advice } = new ConnectorUnavailable(problem, error);
  if (problem === 'install_timeout') expect(advice).toBe('The sign-in component installation timed out. Check your connection and select Retry.');
  expect(accountSignInMessages).toContain(advice);
  for (const locale of NON_ENGLISH_LOCALES) expect(translate(locale, advice!), locale).not.toBe(advice);
});
