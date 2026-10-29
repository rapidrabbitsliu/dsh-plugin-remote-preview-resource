import { createMediaStore, resolveConfig, ROUTE } from './media.js'

export const name = 'remote-preview-resource'
export const inject = ['connection', 'tools']

/** Register owner-authenticated media HTTP access and the model-visible publishing tool. */
export async function apply(ctx, input = {}) {
  // Installation must not break a profile before the owner chooses a safe root and origin.
  if (input.mediaRoot === undefined && input.publicBaseUrl === undefined) return
  const config = resolveConfig(input)
  const store = await createMediaStore(config)
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => store.fetch(request),
  }), 'remote-preview-resource: authenticated media route')

  // Use the public tool definition format: no runtime dependency or second Cordis copy.
  ctx.tools.register({
    name: 'preview_media',
    description: 'Publish an existing audio/video file from the configured media directory as an authenticated HTTP preview. '
      + `Media directory: ${config.mediaRoot}. Generate or copy media into this directory first. `
      + 'Return the previewUrl as a clickable Markdown link in the conversation; never use a file:// or server-local path for remote playback. '
      + 'Links require the same DSH GUI login. This tool does not copy files or transcode codecs.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['file'],
      properties: { file: { type: 'string', description: 'Relative path inside the configured media directory, or absolute path within that directory. Not relative to the session cwd.' } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['file', 'mimeType', 'bytes', 'previewUrl', 'mediaUrl'],
        properties: {
          file: { type: 'string' }, mimeType: { type: 'string' }, bytes: { type: 'integer' },
          previewUrl: { type: 'string' }, mediaUrl: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'file') || typeof args.file !== 'string' || args.file.trim() === '') throw new Error('preview_media requires a non-empty file string')
      const result = await store.describe(args.file)
      exec.signal.throwIfAborted()
      return result
    },
  })
}
