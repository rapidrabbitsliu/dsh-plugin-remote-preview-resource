import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createMediaStore, resolveConfig, parseRange, ROUTE } from '../src/media.js'
import { apply } from '../src/index.js'

async function fixture(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-media-test-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'media')
  await mkdir(root)
  await writeFile(join(root, 'sample.mp3'), '0123456789')
  await writeFile(join(root, 'clip.mp4'), 'video')
  await writeFile(join(root, 'secret.txt'), 'secret')
  await writeFile(join(root, 'empty.wav'), '')
  await writeFile(join(base, 'outside.mp3'), 'outside')
  await mkdir(join(root, 'folder.mp3'))
  return { base, root, store: await createMediaStore(resolveConfig({ mediaRoot: root, publicBaseUrl: 'http://localhost/', ...options })) }
}
function req(file = 'sample.mp3', options = {}, view = 'stream') {
  return new Request(`http://localhost${ROUTE}?${new URLSearchParams({ file, view })}`, options)
}

test('requires an absolute dedicated root and safe public URL', () => {
  assert.throws(() => resolveConfig({}), /mediaRoot/)
  assert.throws(() => resolveConfig({ mediaRoot: 'relative' }), /absolute/)
  for (const publicBaseUrl of ['file:///x', 'http://user:password@x', 'https://x/?token=a', 'https://x/#x']) {
    assert.throws(() => resolveConfig({ mediaRoot: resolve('media'), publicBaseUrl }))
  }
})

test('full streaming, HEAD, empty file and video MIME', async t => {
  const { store } = await fixture(t)
  let response = await store.fetch(req())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'audio/mpeg')
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-length'), '10')
  assert.equal(await response.text(), '0123456789')
  response = await store.fetch(req('sample.mp3', { method: 'HEAD', headers: { range: 'bytes=1-2' } }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-length'), '10')
  assert.equal(await response.text(), '')
  response = await store.fetch(req('empty.wav'))
  assert.equal(response.headers.get('content-length'), '0')
  assert.equal(await response.text(), '')
  response = await store.fetch(req('clip.mp4'))
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(await response.text(), 'video')
})

test('supports seeking and suffix ranges, rejects invalid ranges', async t => {
  const { store } = await fixture(t)
  for (const [range, text, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-999', '89', 'bytes 8-9/10'],
  ]) {
    const response = await store.fetch(req('sample.mp3', { headers: { range } }))
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), contentRange)
    assert.equal(await response.text(), text)
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'bad', 'bytes=9007199254740992-']) {
    const response = await store.fetch(req('sample.mp3', { headers: { range } }))
    assert.equal(response.status, 416, range)
    assert.equal(response.headers.get('content-range'), 'bytes */10')
  }
  const response = await store.fetch(req('sample.mp3', { headers: { range: 'bytes=1-2', 'if-range': 'stale' } }))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '0123456789')
  assert.throws(() => parseRange('bytes=0-', 0))
})

test('rejects traversal, arbitrary files, unsupported extensions and malformed requests', async t => {
  const { base, root, store } = await fixture(t)
  for (const [file, status] of [['../outside.mp3', 403], [join(base, 'outside.mp3'), 403], ['secret.txt', 415], ['absent.mp3', 404], ['folder.mp3', 404], ['', 400], ['bad\0.mp3', 400]]) {
    assert.equal((await store.fetch(req(file))).status, status, file)
  }
  assert.equal((await store.fetch(new Request(`http://localhost${ROUTE}?file=sample.mp3&file=clip.mp4`))).status, 400)
  assert.equal((await store.fetch(req('sample.mp3', {}, 'unknown'))).status, 400)
  assert.equal((await store.fetch(req('sample.mp3', { method: 'POST' }))).status, 405)
  // Junctions work without Windows Developer Mode; they exercise canonical containment.
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'hidden.mp3'), 'private')
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await store.fetch(req('escape/hidden.mp3'))).status, 403)
})

test('player escapes names and preserves reverse proxy mount with query-only media URL', async t => {
  const { root, store } = await fixture(t)
  const file = "a&'播放.mp3"
  await writeFile(join(root, file), 'audio')
  const response = await store.fetch(req(file, {}, 'player'))
  const html = await response.text()
  assert.match(html, /<audio controls/)
  assert.ok(html.includes('a&amp;&#39;播放.mp3'))
  assert.match(html, /src="\?file=/)
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
  const head = await store.fetch(req(file, { method: 'HEAD' }, 'player'))
  assert.equal(await head.text(), '')
  const description = await store.describe(file)
  assert.equal(description.bytes, 5)
  assert.ok(description.previewUrl.startsWith(`http://localhost${ROUTE}?`))
  assert.equal(new URL(description.previewUrl, 'https://example.com').searchParams.get('file'), file)
  const video = await store.fetch(req('clip.mp4', {}, 'player'))
  assert.match(await video.text(), /<video controls/)
})

test('public base URL produces remotely accessible links with mount prefix', async t => {
  const { store } = await fixture(t, { publicBaseUrl: 'https://harness.example/dsh' })
  const result = await store.describe('sample.mp3')
  assert.equal(result.previewUrl, 'https://harness.example/dsh/api/remote-preview-resource?file=sample.mp3&view=player')
})

test('stream cancellation closes the descriptor', async t => {
  const { store } = await fixture(t)
  const response = await store.fetch(req())
  await response.body.cancel()
})

test('plugin registers shared route and tool with a lifecycle disposer (host mock)', async t => {
  const { root } = await fixture(t)
  let route, tool, disposed = false
  const ctx = {
    effect(start) { const dispose = start(); t.after(dispose) },
    connection: { fetch: { register(value) { route = value; return async () => { disposed = true } } } },
    tools: { register(value) { tool = value } },
  }
  await apply(ctx, { mediaRoot: root, publicBaseUrl: 'http://localhost/' })
  assert.equal(route.path, ROUTE)
  assert.deepEqual(route.methods, ['GET', 'HEAD'])
  assert.equal(tool.name, 'preview_media')
  assert.deepEqual(tool.parameters.required, ['file'])
  const result = await tool.execute({ file: 'sample.mp3' }, { signal: new AbortController().signal })
  assert.equal(result.bytes, 10)
  assert.match(tool.output.render({}, result)[0].text, /previewUrl/)
  const response = await route.fetch(req())
  assert.equal(await response.text(), '0123456789')
  await assert.rejects(tool.execute({ file: '../outside.mp3' }, { signal: new AbortController().signal }))
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }))
  assert.equal(disposed, false)
})

test('unconfigured install stays inert while partial configuration is rejected', async () => {
  await apply({})
  await apply({}, {})
  await assert.rejects(apply({}, { mediaRoot: resolve('media') }), /publicBaseUrl/)
  await assert.rejects(apply({}, { publicBaseUrl: 'https://example.com/' }), /mediaRoot/)
})
