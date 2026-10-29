const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    for (const mount of ['/', '/dsh/']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://harness.example/**', route => {
        if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>' });
        return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.alloc(0) });
      });
      await page.goto(`https://harness.example${mount}`);
      await page.evaluate(mount => {
        window.disposers = [];
        window.__ModuleLoader__ = { load(def) { def.factory().apply({ locale: { getSnapshot: () => ({ active: 'zh' }) }, effect(start) { window.disposers.push(start()); } }); } };
        const a = document.createElement('a'); a.id = 'preview'; a.href = `${mount}api/remote-preview-resource?file=clip.mp4&view=player`; a.textContent = '播放'; document.body.append(a);
        window.attempt = (href, options = {}) => {
          const anchor = document.createElement('a'); anchor.href = href;
          if (options.download) anchor.download = 'file';
          document.body.append(anchor);
          let prevented;
          const stopNavigation = e => { prevented = e.defaultPrevented; e.preventDefault(); };
          document.addEventListener('click', stopNavigation, { once: true });
          anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
          document.removeEventListener('click', stopNavigation); anchor.remove();
          return prevented;
        };
      }, mount);
      await page.addScriptTag({ content: await readFile(path.join(__dirname, '../client.js'), 'utf8') });
      const originalUrl = page.url();
      await page.locator('#preview').click();
      assert.equal(page.url(), originalUrl);
      const modal = page.locator('[role="dialog"][aria-modal="true"]');
      await modal.waitFor();
      assert.equal(await page.locator('video').count(), 1);
      assert.equal(await page.locator('video').getAttribute('playsinline'), '');
      const bounds = await modal.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await page.getByRole('button', { name: '关闭播放器' }).click();
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'preview');
      await page.locator('#preview').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').count(), 0);
      await page.locator('#preview').click();
      await page.evaluate(() => document.querySelector('#preview').remove());
      await page.waitForFunction(() => !document.querySelector('dialog'));
      for (const [href, options] of [
        ['https://other.example/api/remote-preview-resource?file=a.mp3&view=player', {}],
        [`${mount}unrelated/api/remote-preview-resource?file=a.mp3&view=player`, {}],
        [`${mount}api/remote-preview-resource?file=a.mp3&view=stream`, {}],
        [`${mount}api/remote-preview-resource?file=a.mp3&file=b.mp3&view=player`, {}],
        [`${mount}api/remote-preview-resource?file=a.mp3&view=player`, { ctrlKey: true }],
        [`${mount}api/remote-preview-resource?file=a.mp3&view=player`, { download: true }],
      ]) {
        assert.equal(await page.evaluate(([href, options]) => window.attempt(href, options), [href, options]), false, href);
        assert.equal(await page.locator('dialog').count(), 0);
      }
      await page.evaluate(mount => {
        const a = document.createElement('a'); a.id = 'audio'; a.href = `${mount}api/remote-preview-resource?file=a.mp3&view=player`; a.textContent = 'audio'; document.body.append(a);
      }, mount);
      await page.locator('#audio').click();
      assert.equal(await page.locator('audio').count(), 1);
      await page.evaluate(() => window.disposers.forEach(fn => fn()));
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(await page.locator('[data-dsh-media-style]').count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS modal lifecycle, precise links, audio, mobile geometry: ${mount}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
