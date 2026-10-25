const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        const data = url.pathname.endsWith('/dashboard')
          ? { abilityProfileSummary: null, activePlanSummary: null, recentIssues: [], todayTasks: [] }
          : {};
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ success: true, data }));
        return;
      }

      const relativePath = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const filePath = path.resolve(PUBLIC_DIR, relativePath);
      if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
        response.end(content);
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

function rgbLuminance(value) {
  const normalizedValue = String(value).trim();
  const hexMatch = normalizedValue.match(/^#([0-9a-f]{6})$/i);
  const channels = hexMatch
    ? hexMatch[1].match(/.{2}/g).map((channel) => parseInt(channel, 16))
    : normalizedValue.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  assert.strictEqual(channels.length, 3, `Expected an RGB color, got: ${value}`);
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const brighter = Math.max(rgbLuminance(first), rgbLuminance(second));
  const darker = Math.min(rgbLuminance(first), rgbLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

async function themeSnapshot(page) {
  return page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const body = style('body');
    const header = style('.app-header');
    const primary = style('button.primary');
    const input = style('#topicInput');
    const sidebar = style('.side-nav');
    const activeNav = style('.nav-item.active');
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      appBackground: root.getPropertyValue('--app-bg').trim(),
      accent: root.getPropertyValue('--app-accent').trim(),
      accentSecondary: root.getPropertyValue('--app-accent-secondary').trim(),
      bodyBackground: body.backgroundColor,
      bodyBackgroundImage: body.backgroundImage,
      bodyFont: body.fontFamily,
      headerPosition: header.position,
      headerTop: header.top,
      headerBackdrop: header.backdropFilter || header.webkitBackdropFilter,
      primaryBackground: primary.backgroundColor,
      primaryBackgroundImage: primary.backgroundImage,
      inputRadius: parseFloat(input.borderRadius),
      sidebarPosition: sidebar.position,
      sidebarOverflowX: sidebar.overflowX,
      activeNavBackground: activeNav.backgroundColor,
      activeNavBackgroundImage: activeNav.backgroundImage,
      activeNavColor: activeNav.color,
      activeNavText: document.querySelector('.nav-item.active')?.textContent?.trim(),
      activeViewId: document.querySelector('.view.active')?.id,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth
    };
  });
}

async function waitForTheme(page, theme) {
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
  await page.waitForFunction(() => {
    const rootAccent = getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim();
    return getComputedStyle(document.querySelector('button.primary')).backgroundColor !== 'rgba(0, 0, 0, 0)'
      && Boolean(rootAccent);
  });
}

async function clippedElements(page) {
  return page.evaluate(() => {
    const selectors = [
      '.app-header',
      '.dashboard-band',
      '.stat-block',
      '.feature-card',
      '.side-nav',
      '.view.active input',
      '.view.active select',
      '.view.active textarea',
      '.view.active .actions button'
    ];
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        return visible && (rect.left < -0.5 || rect.right > innerWidth + 0.5);
      })
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${element.className}`);
  });
}

(async () => {
  const { server, baseUrl } = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem('essayCoachTheme'));
    await page.goto(`${baseUrl}/app.html`, { waitUntil: 'networkidle' });
    await page.locator('.startup-splash').waitFor({ state: 'hidden', timeout: 4000 });

    const light = await themeSnapshot(page);
    assert.strictEqual(light.theme, 'light');
    assert.strictEqual(light.accent, '#1dba9b', 'Light theme must restore the original teal brand color');
    assert.strictEqual(light.accentSecondary, '#2f80ed', 'Light theme must restore the original blue companion color');
    assert.ok(rgbLuminance(light.bodyBackground) > 0.85, `Light background is too dark: ${light.bodyBackground}`);
    assert.notStrictEqual(light.bodyBackgroundImage, 'none', 'Light theme must restore its blue-tinted background');
    assert.match(light.bodyFont, /-apple-system|BlinkMacSystemFont/i);
    assert.strictEqual(light.headerPosition, 'sticky');
    assert.strictEqual(light.headerTop, '0px');
    assert.notStrictEqual(light.headerBackdrop, 'none');
    assert.ok(light.inputRadius >= 10, `Input radius is too small: ${light.inputRadius}`);
    assert.ok(light.sidebarPosition === 'sticky' || light.sidebarPosition === 'fixed');
    assert.match(light.activeNavBackground, /^rgb\(/, `Active navigation must use an opaque accent: ${light.activeNavBackground}`);
    assert.strictEqual(light.activeNavBackground, light.primaryBackground, 'Active navigation and primary actions must share the accent color');
    assert.notStrictEqual(light.primaryBackgroundImage, 'none', 'Primary actions must use the teal-to-blue gradient');
    assert.strictEqual(light.activeNavBackgroundImage, light.primaryBackgroundImage, 'Active navigation and primary actions must share the brand gradient');
    assert.ok(contrastRatio(light.activeNavColor, light.accent) >= 4.5, `Active navigation text lacks contrast against teal: ${light.activeNavColor}`);
    assert.ok(contrastRatio(light.activeNavColor, light.accentSecondary) >= 4.5, `Active navigation text lacks contrast against blue: ${light.activeNavColor}`);

    await page.getByRole('button', { name: '我写完了', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.view.active')?.id === 'view-revise');
    const revisedView = await themeSnapshot(page);
    assert.strictEqual(revisedView.activeNavText, '我写完了');
    assert.strictEqual(revisedView.activeViewId, 'view-revise');

    await page.getByRole('button', { name: '切换到深色模式' }).click();
    await waitForTheme(page, 'dark');
    const dark = await themeSnapshot(page);
    assert.strictEqual(dark.accent, '#47d2c5', 'Dark theme must restore the original teal brand color');
    assert.strictEqual(dark.accentSecondary, '#6f8dff', 'Dark theme must restore the original blue-violet companion color');
    assert.ok(rgbLuminance(dark.bodyBackground) < 0.08, `Dark background is too light: ${dark.bodyBackground}; --app-bg=${dark.appBackground}`);
    assert.notStrictEqual(dark.bodyBackgroundImage, 'none', 'Dark theme must restore its deep-blue background');
    assert.notStrictEqual(dark.primaryBackgroundImage, 'none', 'Dark primary actions must use the teal-to-blue gradient');
    assert.ok(contrastRatio(dark.activeNavColor, dark.accent) >= 4.5, `Dark active navigation text lacks contrast against teal: ${dark.activeNavColor}`);
    assert.ok(contrastRatio(dark.activeNavColor, dark.accentSecondary) >= 4.5, `Dark active navigation text lacks contrast against blue: ${dark.activeNavColor}`);
    assert.notStrictEqual(dark.bodyBackground, light.bodyBackground);
    assert.notStrictEqual(dark.primaryBackground, light.primaryBackground);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDark = await themeSnapshot(page);
    assert.ok(['auto', 'scroll'].includes(mobileDark.sidebarOverflowX));
    assert.ok(mobileDark.documentWidth <= mobileDark.viewportWidth, `Dark mobile page overflows: ${mobileDark.documentWidth}px > ${mobileDark.viewportWidth}px`);
    assert.deepStrictEqual(await clippedElements(page), [], 'Dark mobile controls must remain inside the viewport');

    await page.getByRole('button', { name: '切换到浅色模式' }).click();
    await waitForTheme(page, 'light');
    const mobileLight = await themeSnapshot(page);
    assert.ok(['auto', 'scroll'].includes(mobileLight.sidebarOverflowX));
    assert.ok(mobileLight.documentWidth <= mobileLight.viewportWidth, `Light mobile page overflows: ${mobileLight.documentWidth}px > ${mobileLight.viewportWidth}px`);
    assert.deepStrictEqual(await clippedElements(page), [], 'Light mobile controls must remain inside the viewport');
    assert.deepStrictEqual(browserErrors, [], `Browser errors detected:\n${browserErrors.join('\n')}`);

    console.log('PASS real /app integration keeps Apple themes, navigation, and mobile controls responsive');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
