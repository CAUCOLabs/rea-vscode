// Explicit local authorization, verified against REA's session contract and
// registerSessionRecordTools implementation. Names/annotations never grant access.
export const READ_ONLY_TOOL = 'list_unknowns';
export type Arguments = Record<string, string | number>;
export interface EditorField {
  name: string;
  type: 'string' | 'integer';
  required: boolean;
  enum?: string[];
  default?: string | number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
}
export type ExecutionEditor = { supported: true; fields: EditorField[] } | { supported: false; reason: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const names: Record<string, string> = { status: 'string', severity: 'string', domain: 'string', offset: 'integer', limit: 'integer' };
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const allowed = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

export function executionEditor(name: string, schema: unknown): ExecutionEditor {
  const unsupported = { supported: false, reason: 'Execution unavailable: the live input schema is not supported by this editor.' } as const;
  if (name !== READ_ONLY_TOOL) return { supported: false, reason: 'Tool execution is not allowed.' };
  if (!record(schema) || schema.type !== 'object' || !record(schema.properties) || schema.additionalProperties !== false) return unsupported;
  if (!allowed(schema, ['type', 'properties', 'required', 'additionalProperties', '$schema', 'description', 'title', 'examples'])) return unsupported;
  if (schema.$schema !== undefined && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') return unsupported;
  const required = schema.required === undefined ? [] : schema.required;
  if (!Array.isArray(required) || required.some(key => typeof key !== 'string' || !owns(schema.properties as object, key))) return unsupported;
  if (Object.keys(schema.properties).length !== 5 || Object.keys(schema.properties).some(key => !owns(names, key))) return unsupported;
  const fields: EditorField[] = [];
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!record(value) || value.type !== names[key]) return unsupported;
    const numeric = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'];
    const lengths = ['minLength', 'maxLength'];
    const constraints = value.type === 'string' ? ['enum', ...lengths] : numeric;
    if (!allowed(value, ['type', 'description', 'title', 'default', 'examples', ...constraints])) return unsupported;
    if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.some(item => typeof item !== 'string'))) return unsupported;
    for (const constraint of [...numeric, ...lengths]) {
      if (value[constraint] !== undefined && (typeof value[constraint] !== 'number' || !Number.isFinite(value[constraint]))) return unsupported;
    }
    for (const constraint of lengths) {
      if (value[constraint] !== undefined && (!Number.isSafeInteger(value[constraint]) || (value[constraint] as number) < 0)) return unsupported;
    }
    if (owns(value, 'default') && (value.type === 'string' ? typeof value.default !== 'string' : !Number.isSafeInteger(value.default))) return unsupported;
    const field = { ...value, name: key, required: required.includes(key) } as unknown as EditorField;
    // Local query budget: always page; never silently request an unbounded result.
    if (key === 'offset') { field.minimum = Math.max(0, field.minimum ?? 0); field.default = 0; }
    if (key === 'limit') { field.minimum = Math.max(1, field.minimum ?? 1); field.maximum = Math.min(100, field.maximum ?? 100); field.default = 50; }
    fields.push(field);
  }
  return { supported: true, fields };
}

export function validateReadOnlyArguments(name: string, schema: unknown, input: unknown): { ok: true; arguments: Arguments } | { ok: false; error: string } {
  const editor = executionEditor(name, schema);
  if (!editor.supported) return { ok: false, error: editor.reason };
  if (!record(input) || Object.keys(input).some(key => !owns(names, key))) return { ok: false, error: 'Arguments must contain only supported parameter names.' };
  const args: Arguments = {};
  for (const field of editor.fields) {
    let value = owns(input, field.name) ? input[field.name] : field.default;
    if (value === undefined) {
      if (field.required) return { ok: false, error: `${field.name} is required.` };
      continue;
    }
    if (field.type === 'string') {
      if (typeof value !== 'string') return { ok: false, error: `${field.name} must be a string.` };
      if (field.name === 'domain') value = value.trim();
      const length = [...(value as string)].length;
      if (length > 4096 || (field.minLength !== undefined && length < field.minLength) || (field.maxLength !== undefined && length > field.maxLength) || (field.enum && !field.enum.includes(value as string))) {
        return { ok: false, error: `${field.name} does not satisfy its string constraints.` };
      }
    } else {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { ok: false, error: `${field.name} must be a safe integer.` };
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum) || (field.exclusiveMinimum !== undefined && value <= field.exclusiveMinimum) || (field.exclusiveMaximum !== undefined && value >= field.exclusiveMaximum)) {
        return { ok: false, error: `${field.name} is outside its allowed range.` };
      }
    }
    args[field.name] = value as string | number;
  }
  return { ok: true, arguments: args };
}
