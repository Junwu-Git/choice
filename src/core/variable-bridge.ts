import { chat_metadata } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';

const getHelper = () => window.TavernHelper;

function collectVariables(): Record<string, any> {
  const variables: Record<string, any> = {};
  const helper = getHelper();
  if (helper) {
    try {
      _.assign(variables, helper.getVariables({ type: 'chat' }));
    } catch {
      // ignore
    }
    try {
      _.assign(variables, helper.getVariables({ type: 'global' }));
    } catch {
      // ignore
    }
  } else {
    _.assign(variables, chat_metadata.variables ?? {});
    _.assign(variables, extension_settings.variables?.global ?? {});
  }
  return variables;
}

const CONDITION_OPERATORS = ['>=', '<=', '==', '!=', '>', '<'] as const;

const parseValue = (raw: string): unknown => {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  const num = Number(raw);
  if (raw !== '' && !Number.isNaN(num)) {
    return num;
  }
  return raw;
};

const compare = (a: unknown, b: unknown, op: string): boolean => {
  switch (op) {
    case '==':
      return a == b;
    case '!=':
      return a != b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
};

export function evaluateCondition(condition: string): boolean {
  const trimmed = condition.trim();
  if (!trimmed) {
    return true;
  }
  let parsed: { path: string; op: string; value: unknown } | null = null;
  for (const op of CONDITION_OPERATORS) {
    const index = trimmed.indexOf(op);
    if (index === -1) {
      continue;
    }
    const path = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + op.length).trim();
    if (!path || rawValue === '') {
      continue;
    }
    parsed = { path, op, value: parseValue(rawValue) };
    break;
  }
  if (!parsed) {
    return true;
  }
  const actual = _.get(collectVariables(), parsed.path);
  if (actual === undefined) {
    return false;
  }
  return compare(actual, parsed.value, parsed.op);
}
