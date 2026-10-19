// Schema shape verified from the local REA 6.7.0 MCP catalog.
export const readOnlySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['open', 'investigating', 'blocked', 'contradicted', 'resolved'], description: 'Current lifecycle or verification status.' },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    domain: { type: 'string', minLength: 1 },
    offset: { default: 0, type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    limit: { type: 'integer', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  },
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  examples: [{ offset: 0, limit: 50 }]
};
