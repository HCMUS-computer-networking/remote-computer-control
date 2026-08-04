const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

// Schema mặc định cho các lệnh không yêu cầu params
const emptyParamsSchema = {
  type: ['object', 'null'],
  maxProperties: 0,
};

// Định nghĩa JSON Schema cho từng Module/Command
const schemas = {
  // Application Module
  app_list: emptyParamsSchema,
  app_start: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  app_stop: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },

  // Process Module
  proc_list: emptyParamsSchema,
  proc_kill: {
    type: 'object',
    properties: { pid: { type: 'integer', minimum: 1 } },
    required: ['pid'],
    additionalProperties: false,
  },

  // System Info Module
  sysinfo: emptyParamsSchema,

  // Power Module (all use type 'power' but we can route them via action if needed, or by type)
  power_lock: emptyParamsSchema,
  power_restart: emptyParamsSchema,
  power_shutdown: emptyParamsSchema,
  power_sleep: emptyParamsSchema,

  // Input Module
  input_mouse_move: {
    type: 'object',
    properties: { x: { type: 'integer' }, y: { type: 'integer' } },
    required: ['x', 'y'],
    additionalProperties: false,
  },
  input_mouse_click: {
    type: 'object',
    properties: {
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      action: { type: 'string', enum: ['click', 'down', 'up'] },
    },
    required: ['button', 'action'],
    additionalProperties: false,
  },
  input_key: {
    type: 'object',
    properties: {
      vk: { type: 'integer' },
      action: { type: 'string', enum: ['press', 'down', 'up'] },
    },
    required: ['vk', 'action'],
    additionalProperties: false,
  },
  input_type: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },

  // Keylogger Module
  keylog_start: emptyParamsSchema,
  keylog_stop: emptyParamsSchema,

  // Screen Streaming Module
  screen_stream: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['stream'] },
      fps: { type: 'integer', minimum: 1 },
      quality: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  screen_stream_stop: emptyParamsSchema,
  screenshot: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['once'] },
      quality: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['mode'],
    additionalProperties: false,
  },

  // Webcam Module
  webcam_start: {
    type: 'object',
    properties: {
      fps: { type: 'integer', minimum: 1 },
      quality: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  webcam_stop: emptyParamsSchema,

  // File System Module
  fs_list: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  fs_get: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      transfer_id: { type: 'string' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  fs_put: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      chunk_index: { type: 'integer', minimum: 0 },
      total_chunks: { type: 'integer', minimum: 1 },
      transfer_id: { type: 'string' },
      total_size: { type: 'integer', minimum: 0 },
      data_base64: { type: 'string' },
    },
    required: ['path', 'chunk_index', 'total_chunks', 'transfer_id', 'data_base64'],
    additionalProperties: false,
  },

  // Policy & Permissions
  policy_update: {
    type: 'object',
    properties: {
      app_whitelist: { type: 'array', items: { type: 'string' } },
      sandbox_path: { type: 'string' },
    },
    minProperties: 1,
    additionalProperties: false,
  },
  permission_request: emptyParamsSchema,
  permission_revoke: emptyParamsSchema,
  stop_module: emptyParamsSchema,
};

// Biên dịch sẵn các schema để tăng hiệu suất
const validators = {};
for (const [key, schema] of Object.entries(schemas)) {
  validators[key] = ajv.compile(schema);
}

/**
 * Validate params of a command
 * @param {string} commandKey - The module/action name (e.g. 'proc_kill')
 * @param {object} params - The params object to validate
 * @returns {object} { valid: boolean, errors: array, errorText: string }
 */
function validateParams(commandKey, params) {
  const validator = validators[commandKey];
  if (!validator) {
    return { valid: true, errors: null, errorText: null };
  }

  const data = params === undefined ? null : params;
  const valid = validator(data);

  return {
    valid,
    errors: validator.errors,
    errorText: valid ? null : ajv.errorsText(validator.errors)
  };
}

module.exports = {
  validateParams,
};
