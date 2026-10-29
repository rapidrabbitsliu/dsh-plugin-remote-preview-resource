window.__ModuleLoader__.load({
  id: 'dsh-plugin-remote-preview-resource',
  factory() {
    const dictionaries = {
      zh: { title: '媒体预览', close: '关闭播放器', open: '在新页面打开', error: '无法播放。请确认已登录、文件存在，并且浏览器支持该音视频编码。', play: '点击播放，可拖动进度；关闭后返回会话。' },
      en: { title: 'Media preview', close: 'Close player', open: 'Open in a new page', error: 'Unable to play. Check your login, file availability, and browser codec support.', play: 'Press play and seek freely. Close to return to the conversation.' },
    }
    const css = `
.dsh-media-dialog{box-sizing:border-box;width:min(960px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;border:1px solid #454750;border-radius:18px;background:#181a20;color:#f5f5f7;box-shadow:0 24px 100px #0009;font:15px system-ui;overflow:auto;overscroll-behavior:contain}
.dsh-media-dialog::backdrop{background:#000a;backdrop-filter:blur(5px)}
.dsh-media-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid #ffffff20}.dsh-media-title{margin:0;font-size:16px;font-weight:600;overflow-wrap:anywhere;min-width:0}.dsh-media-close{flex-shrink:0;min-width:44px;min-height:44px;border:0;border-radius:10px;background:#ffffff12;color:inherit;cursor:pointer;font:24px system-ui}.dsh-media-dialog :focus-visible{outline:2px solid #91b8ff;outline-offset:3px}
.dsh-media-body{padding:18px}.dsh-media-player{display:block;width:100%;max-height:calc(100dvh - 220px);background:#000;border-radius:10px}.dsh-media-dialog audio{min-height:54px}.dsh-media-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:0 18px 18px;color:#b9bdca;font-size:13px}.dsh-media-footer a{color:#a7c5ff}.dsh-media-error{color:#ffb6b6;margin:12px 0 0;overflow-wrap:anywhere}
@media(max-width:600px){.dsh-media-dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:14px}.dsh-media-header{padding:10px 12px}.dsh-media-body{padding:12px}.dsh-media-footer{padding:0 12px 14px}.dsh-media-player{max-height:calc(100dvh - 210px)}}
`
    /** Accept only this plugin's same-origin player links, including proxy mounts. */
    function previewTarget(anchor, location, baseURI) {
      if (!anchor || anchor.hasAttribute('download')) return null
      let url
      try { url = new URL(anchor.href, location.href) } catch { return null }
      if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return null
      if (url.pathname !== new URL('api/remote-preview-resource', baseURI).pathname || url.username || url.password || url.hash) return null
      if (url.searchParams.getAll('file').length !== 1 || !url.searchParams.get('file')?.trim()) return null
      if (url.searchParams.getAll('view').length !== 1 || url.searchParams.get('view') !== 'player') return null
      return url
    }

    function install(win, ctx) {
      const doc = win.document
      const style = doc.createElement('style')
      style.textContent = css
      style.dataset.dshMediaStyle = ''
      doc.head.append(style)
      let active = null
      function close() {
        if (!active) return
        const { dialog, media, previous, disposeEvents } = active
        active = null
        disposeEvents()
        media.pause()
        media.removeAttribute('src')
        media.load()
        dialog.close()
        dialog.remove()
        if (previous?.isConnected) previous.focus({ preventScroll: true })
      }
      function show(url, anchor) {
        close()
        const t = dictionaries[ctx.locale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en']
        const dialog = doc.createElement('dialog')
        dialog.className = 'dsh-media-dialog'
        dialog.dataset.shortcutModal = 'remote-media'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.setAttribute('aria-label', t.title)
        const header = doc.createElement('header')
        header.className = 'dsh-media-header'
        const title = doc.createElement('h2')
        title.className = 'dsh-media-title'
        title.textContent = url.searchParams.get('file').split(/[\\/]/).at(-1)
        const button = doc.createElement('button')
        button.type = 'button'
        button.className = 'dsh-media-close'
        button.textContent = '×'
        button.setAttribute('aria-label', t.close)
        button.autofocus = true
        header.append(title, button)
        const body = doc.createElement('div')
        body.className = 'dsh-media-body'
        const audio = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac)$/i.test(url.searchParams.get('file'))
        const media = doc.createElement(audio ? 'audio' : 'video')
        media.className = 'dsh-media-player'
        media.controls = true
        media.preload = 'metadata'
        media.setAttribute('playsinline', '')
        media.setAttribute('aria-label', title.textContent)
        const stream = new URL(url)
        stream.searchParams.set('view', 'stream')
        media.src = stream.href
        const error = doc.createElement('p')
        error.className = 'dsh-media-error'
        error.setAttribute('role', 'alert')
        error.hidden = true
        const onError = () => { error.hidden = false; error.textContent = t.error }
        media.addEventListener('error', onError)
        body.append(media, error)
        const footer = doc.createElement('footer')
        footer.className = 'dsh-media-footer'
        const hint = doc.createElement('span')
        hint.textContent = t.play
        const fallback = doc.createElement('a')
        fallback.href = url.href
        fallback.target = '_blank'
        fallback.rel = 'noopener noreferrer'
        fallback.textContent = t.open
        fallback.dataset.dshMediaExternal = ''
        footer.append(hint, fallback)
        dialog.append(header, body, footer)
        const previous = anchor ?? doc.activeElement
        button.addEventListener('click', close)
        const onCancel = event => { event.preventDefault(); event.stopPropagation(); close() }
        const onClose = () => close()
        const onPointer = event => {
          if (event.target !== dialog) return
          const rect = dialog.getBoundingClientRect()
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
        }
        const onNavigate = () => close()
        // DSH can replace the conversation without browser history navigation.
        const sourceObserver = new win.MutationObserver(() => { if (anchor && !anchor.isConnected) close() })
        sourceObserver.observe(doc.body, { childList: true, subtree: true })
        dialog.addEventListener('cancel', onCancel)
        dialog.addEventListener('close', onClose)
        dialog.addEventListener('click', onPointer)
        win.addEventListener('popstate', onNavigate)
        win.addEventListener('hashchange', onNavigate)
        active = { dialog, media, previous, disposeEvents() {
          sourceObserver.disconnect()
          media.removeEventListener('error', onError)
          dialog.removeEventListener('cancel', onCancel)
          dialog.removeEventListener('close', onClose)
          dialog.removeEventListener('click', onPointer)
          win.removeEventListener('popstate', onNavigate)
          win.removeEventListener('hashchange', onNavigate)
        } }
        doc.body.append(dialog)
        try { dialog.showModal() } catch (error) { close(); throw error }
        button.focus({ preventScroll: true })
      }
      function onClick(event) {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        const anchor = event.target instanceof win.Element ? event.target.closest('a[href]') : null
        if (anchor?.hasAttribute('data-dsh-media-external')) return
        const target = previewTarget(anchor, win.location, doc.baseURI)
        if (!target || typeof win.HTMLDialogElement?.prototype.showModal !== 'function') return
        // Take ownership only after the modal opens; unsupported browsers keep normal navigation.
        show(target, anchor)
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      doc.addEventListener('click', onClick, true)
      return () => { doc.removeEventListener('click', onClick, true); close(); style.remove() }
    }
    return {
      inject: ['locale'],
      apply(ctx) { ctx.effect(() => install(window, ctx), 'remote-preview-resource: modal player') },
    }
  },
})
