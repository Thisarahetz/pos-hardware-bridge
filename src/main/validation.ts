import type { ReceiptModel, TerminalChargeRequest } from './types';

/** Returns a list of problems with a request body; empty means it's valid. */
type Check = (body: Record<string, unknown>) => string[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const isMinorUnits = (v: unknown) => Number.isInteger(v);

function requireText(body: Record<string, unknown>, field: string, problems: string[]): void {
  if (!isText(body[field])) problems.push(`"${field}" is required and must be a non-empty string`);
}

function requireMoney(body: Record<string, unknown>, field: string, problems: string[]): void {
  if (!isMinorUnits(body[field])) {
    problems.push(`"${field}" must be a whole number in minor units (e.g. 12.50 → 1250)`);
  }
}

const checkReceipt: Check = (body) => {
  const problems: string[] = [];
  requireText(body, 'businessName', problems);
  requireText(body, 'saleReference', problems);
  requireText(body, 'timestamp', problems);
  requireText(body, 'paymentMethod', problems);
  if (!(typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency))) {
    problems.push('"currency" must be a 3-letter code such as "USD" or "LKR"');
  }
  requireMoney(body, 'subtotalAmount', problems);
  requireMoney(body, 'taxAmount', problems);
  requireMoney(body, 'totalAmount', problems);
  for (const optional of ['locationName', 'footer'] as const) {
    if (body[optional] !== undefined && typeof body[optional] !== 'string') {
      problems.push(`"${optional}" must be a string when given`);
    }
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    problems.push('"lines" must be a non-empty array of items');
  } else {
    body.lines.forEach((line, i) => {
      if (!isObject(line)) {
        problems.push(`lines[${i}] must be an object`);
        return;
      }
      if (!isText(line.label)) problems.push(`lines[${i}].label is required`);
      if (!isMinorUnits(line.totalAmount)) problems.push(`lines[${i}].totalAmount must be a whole number in minor units`);
      if (line.qty !== undefined && !(Number.isInteger(line.qty) && (line.qty as number) > 0)) {
        problems.push(`lines[${i}].qty must be a positive whole number when given`);
      }
      if (line.unitAmount !== undefined && !isMinorUnits(line.unitAmount)) {
        problems.push(`lines[${i}].unitAmount must be a whole number in minor units when given`);
      }
    });
  }
  return problems;
};

const checkCharge: Check = (body) => {
  const problems: string[] = [];
  if (!(Number.isInteger(body.amountMinorUnits) && (body.amountMinorUnits as number) > 0)) {
    problems.push('"amountMinorUnits" must be a positive whole number (e.g. 12.50 → 1250)');
  }
  if (!(typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency))) {
    problems.push('"currency" must be a 3-letter code such as "USD" or "LKR"');
  }
  requireText(body, 'reference', problems);
  return problems;
};

function validate<T>(body: unknown, check: Check): { ok: true; value: T } | { ok: false; problems: string[] } {
  if (!isObject(body)) {
    return { ok: false, problems: ['Request body must be a JSON object (send header "Content-Type: application/json")'] };
  }
  const problems = check(body);
  return problems.length ? { ok: false, problems } : { ok: true, value: body as T };
}

export const validateReceipt = (body: unknown) => validate<ReceiptModel>(body, checkReceipt);
export const validateCharge = (body: unknown) => validate<TerminalChargeRequest>(body, checkCharge);
export const validateReference = (body: unknown) =>
  validate<{ reference: string }>(body, (b) => (isText(b.reference) ? [] : ['"reference" is required']));
