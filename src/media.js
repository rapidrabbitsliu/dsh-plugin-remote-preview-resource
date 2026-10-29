import { open, realpath, mkdir } from 'node:fs/promises'
import { isAbsolute, resolve, relative, extname, basename, sep } from 'node:path'
import { Readable } from 'node:stream'

export const ROUTE = '/api/remote-preview-resource'
const MIME = new Map(Object.entries({
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.mp4': 'video/mp4',
  '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
}))
const COMMON = {
  'cache-control': 'private, no-store, no-transform',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
}

class MediaError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** Test a canonical filesystem path against its configured media directory. */
export function isWithin(root, target) {
  const part = relative(root, target)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** Validate deployment settings; no request header is trusted to choose a public origin. */
export function resolveConfig(input = {}) {
  if (typeof input.mediaRoot !== 'string' || !isAbsolute(input.mediaRoot)) {
    throw new Error('remote-preview-resource: mediaRoot must be an absolute dedicated media directory')
  }
  if (typeof input.publicBaseUrl !== 'string' || input.publicBaseUrl.trim() === '') {
    throw new Error('remote-preview-resource: publicBaseUrl must be the externally reachable DSH GUI HTTP(S) base URL')
  }
  let publicBaseUrl
  {
    const url = new URL(input.publicBaseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('remote-preview-resource: publicBaseUrl must be an HTTP(S) base URL without credentials, query or fragment')
    }
    publicBaseUrl = url.href.endsWith('/') ? url.href : `${url.href}/`
  }
  return { mediaRoot: resolve(input.mediaRoot), publicBaseUrl }
}

/** Resolve exactly one byte range; multiple or malformed ranges are rejected with 416. */
export function parseRange(value, size) {
  if (value === null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size === 0) throw new MediaError(416, 'Invalid byte range')
  let start, end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new MediaError(416, 'Invalid byte range')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      throw new MediaError(416, 'Unsatisfiable byte range')
    }
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** Create authenticated-route media responses without loading the media file into memory. */
export async function createMediaStore(config) {
  await mkdir(config.mediaRoot, { recursive: true })
  const root = await realpath(config.mediaRoot)

  async function openMedia(file) {
    if (typeof file !== 'string' || file.trim() === '' || file.includes('\0')) throw new MediaError(400, 'A media file is required')
    const lexical = resolve(root, file)
    if (!isWithin(root, lexical)) throw new MediaError(403, 'File is outside the media directory')
    const canonical = await realpath(lexical)
    if (!isWithin(root, canonical)) throw new MediaError(403, 'Symlink points outside the media directory')
    const mime = MIME.get(extname(canonical).toLowerCase())
    if (!mime) throw new MediaError(415, 'Only supported audio and video files can be previewed')
    const handle = await open(canonical, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new MediaError(404, 'Not a regular media file')
      if (!Number.isSafeInteger(stat.size)) throw new MediaError(413, 'Media file is too large')
      return { handle, stat, mime, file: relative(root, canonical).split(sep).join('/') }
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  function link(file, view) {
    const path = `${ROUTE.slice(1)}?${new URLSearchParams({ file, view })}`
    return new URL(path, config.publicBaseUrl).href
  }

  async function describe(file) {
    const media = await openMedia(file)
    await media.handle.close()
    return {
      file: media.file, mimeType: media.mime, bytes: media.stat.size,
      previewUrl: link(media.file, 'player'), mediaUrl: link(media.file, 'stream'),
    }
  }

  async function fetch(request) {
    let media
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...COMMON, allow: 'GET, HEAD' } })
      const url = new URL(request.url)
      if (url.searchParams.getAll('file').length !== 1 || url.searchParams.getAll('view').length > 1) throw new MediaError(400, 'Expected one file parameter')
      const view = url.searchParams.get('view') ?? 'stream'
      if (!['stream', 'player'].includes(view)) throw new MediaError(400, 'Unknown media view')
      media = await openMedia(url.searchParams.get('file'))
      if (view === 'player') {
        await media.handle.close()
        media.handle = undefined
        const tag = media.mime.startsWith('video/') ? 'video' : 'audio'
        // Query-only links preserve reverse-proxy mount prefixes in the browser.
        const source = `?${new URLSearchParams({ file: media.file, view: 'stream' })}`
        const title = escapeHtml(basename(media.file))
        const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:40px auto;padding:0 20px;max-width:960px;background:#15171b;color:#eee}h1{font-size:20px;overflow-wrap:anywhere}video,audio{width:100%;max-height:75vh}a{color:#91b8ff}</style><h1>${title}</h1><${tag} controls preload="metadata" src="${escapeHtml(source)}"></${tag}><p><a href="${escapeHtml(source)}">打开原始媒体 / Open media</a></p><p>如果无法播放，请使用浏览器支持的编码（建议 MP4 H.264/AAC、MP3 或 WebM）；本插件不转码。</p></html>`
        return new Response(request.method === 'HEAD' ? null : html, {
          headers: { ...COMMON, 'content-type': 'text/html; charset=utf-8',
            'content-length': String(Buffer.byteLength(html)),
            'content-security-policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'" },
        })
      }
      const headers = { ...COMMON, 'content-type': media.mime, 'accept-ranges': 'bytes' }
      let range
      try {
        // HEAD ignores Range; If-Range cannot match because we emit no validators.
        range = request.method === 'HEAD' || request.headers.has('if-range') ? undefined : parseRange(request.headers.get('range'), media.stat.size)
      } catch (error) {
        if (error instanceof MediaError && error.status === 416) {
          await media.handle.close()
          media.handle = undefined
          return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${media.stat.size}`, 'content-length': '0' } })
        }
        throw error
      }
      headers['content-length'] = String(range ? range.end - range.start + 1 : media.stat.size)
      if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${media.stat.size}`
      if (request.method === 'HEAD' || media.stat.size === 0) {
        await media.handle.close()
        media.handle = undefined
        return new Response(null, { status: 200, headers })
      }
      const stream = media.handle.createReadStream({ ...range, autoClose: true })
      media.handle = undefined // The stream now owns this descriptor, including cancellation.
      const abort = () => stream.destroy()
      request.signal.addEventListener('abort', abort, { once: true })
      stream.once('close', () => request.signal.removeEventListener('abort', abort))
      if (request.signal.aborted) abort()
      return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers })
    } catch (error) {
      if (media?.handle) await media.handle.close()
      let status = error instanceof MediaError ? error.status : ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : ['EACCES', 'EPERM', 'ELOOP'].includes(error.code) ? 403 : 500
      const message = error instanceof MediaError ? error.message : status === 404 ? 'Media file not found' : status === 403 ? 'Media access denied' : 'Unable to read media file; check server permissions'
      return new Response(request.method === 'HEAD' ? null : message, { status, headers: { ...COMMON, 'content-type': 'text/plain; charset=utf-8' } })
    }
  }
  return { describe, fetch }
}
