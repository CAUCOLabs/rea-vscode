import { describe, expect, it } from 'vitest';
import { executionEditor, validateReadOnlyArguments } from '../src/services/readOnlyExecution';
import { parseSidebarMessage } from '../src/views/sidebarProtocol';
import { readOnlySchema } from './readOnlyFixture';

const validate = (input: unknown, schema: unknown = readOnlySchema) => validateReadOnlyArguments('list_unknowns', schema, input);

describe('Read-only authorization and parameter validation', () => {
  it('accepts the live schema subset and always bounds omitted pagination', () => {
    expect(executionEditor('list_unknowns', readOnlySchema).supported).toBe(true);
    expect(validate({})).toEqual({ ok: true, arguments: { offset: 0, limit: 50 } });
    expect(validate({ status: 'open', severity: 'high', domain: ' web ', offset: 10, limit: 5 })).toEqual({ ok: true, arguments: { status: 'open', severity: 'high', domain: 'web', offset: 10, limit: 5 } });
  });
  it('does not grant authorization from naming patterns or readOnlyHint', () => {
    expect(executionEditor('list_documents', { ...readOnlySchema, readOnlyHint: true }).supported).toBe(false);
    expect(validateReadOnlyArguments('open_binary', readOnlySchema, {}).ok).toBe(false);
  });
  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '10' }, { limit: null },
    { offset: -1 }, { offset: Infinity }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'invented' }, { severity: 'invented' }, { domain: '  ' }, { domain: 'x'.repeat(4097) },
    { extra: 'value' }, { status: { value: 'open' } }, [], null
  ])('rejects invalid or unbounded arguments: %j', input => {
    expect(validate(input).ok).toBe(false);
  });
  it.each([
    { $ref: '#/$defs/alternate' }, { oneOf: [] }, { additionalProperties: true },
    { required: ['missing'] }, { required: null }, { $schema: 'unrecognized dialect' }
  ])('fails closed for unsupported root schema: %j', patch => {
    expect(validate({}, { ...readOnlySchema, ...patch }).ok).toBe(false);
  });
  it.each([
    { type: ['string', 'null'] }, { pattern: '^safe' }, { format: 'uri' },
    { anyOf: [{ type: 'string' }] }, { $ref: '#/definitions/domain' },
    { minLength: -1 }, { minLength: 1.2 }, { enum: [1, 2] }
  ])('fails closed for unsupported field schema: %j', patch => {
    const schema = structuredClone(readOnlySchema);
    Object.assign(schema.properties.domain, patch);
    expect(validate({}, schema).ok).toBe(false);
  });
  it('checks required values, lengths, and inclusive/exclusive limits', () => {
    const schema = { ...readOnlySchema, required: ['domain'], properties: {
      ...readOnlySchema.properties,
      domain: { type: 'string', minLength: 2, maxLength: 4 },
      offset: { type: 'integer', exclusiveMinimum: 5, exclusiveMaximum: 9 }
    } };
    expect(validate({ domain: 'a', offset: 6 }, schema).ok).toBe(false);
    expect(validate({ domain: 'abcde', offset: 6 }, schema).ok).toBe(false);
    expect(validate({ offset: 6 }, schema).ok).toBe(false);
    expect(validate({ domain: 'ab', offset: 5 }, schema).ok).toBe(false);
    expect(validate({ domain: 'ab', offset: 9 }, schema).ok).toBe(false);
    expect(validate({ domain: 'ab', offset: 6 }, schema).ok).toBe(true);
  });
  it('rejects forged execution messages and never accepts a tool name from the Webview', () => {
    for (const message of [
      { type: 'execute' }, { type: 'execute', arguments: [], name: 'open_binary' },
      { type: 'execute', arguments: { limit: NaN } }, { type: 'execute', arguments: { domain: { nested: true } } },
      { type: 'execute', arguments: {}, command: 'anything' }
    ]) expect(parseSidebarMessage(message)).toBeUndefined();
    expect(parseSidebarMessage({ type: 'execute', arguments: { limit: 10, status: 'open' } })).toEqual({ type: 'execute', arguments: { limit: 10, status: 'open' } });
  });
});
