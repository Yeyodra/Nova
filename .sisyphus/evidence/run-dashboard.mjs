// Playwright dashboard QA runner v2
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const EVID_DIR = '.sisyphus/evidence';
const BASE = 'http://localhost:1931';
const PASSWORD = 'bintang088';
const ev = (name) => path.join(EVID_DIR, `qa-f3-${name}.png`);
const results = {};

async function login(page) {
  await page.goto(BASE + '/');
  await page.waitForLoadState('domcontentloaded');
  const pwd = page.locator('input[type="password"]').first();
  await pwd.waitFor({ state: 'visible', timeout: 15000 });
  await pwd.fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
  await page.waitForFunction(
    () => !document.querySelector('input[type="password"]'),
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(1500);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // Dashboard built JS computes API base as port-1 (1930). Server only listens on 1931.
  // Reroute all 1930 -> 1931 so dashboard can talk to backend.
  await context.route(/^http:\/\/localhost:1930\/.+/, async (route) => {
    const req = route.request();
    const newUrl = req.url().replace('localhost:1930', 'localhost:1931');
    const headers = { ...req.headers() };
    delete headers['host'];
    try {
      const resp = await fetch(newUrl, {
        method: req.method(),
        headers,
        body: req.method() === 'GET' || req.method() === 'HEAD' ? undefined : req.postData() ?? undefined,
        redirect: 'manual',
      });
      const respHeaders = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      const body = Buffer.from(await resp.arrayBuffer());
      await route.fulfill({ status: resp.status, headers: respHeaders, body });
    } catch (e) {
      await route.abort();
    }
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()); });

  try {
    // S15: Login + Combos navigation
    console.log('--- S15 ---');
    try {
      await login(page);
      await page.screenshot({ path: ev('15a-after-login') });
      const combosLink = page.getByRole('link', { name: /combos/i }).first();
      await combosLink.waitFor({ state: 'visible', timeout: 10000 });
      await combosLink.click();
      await page.waitForURL(/\/combos/, { timeout: 10000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: ev('15-combos-page') });
      const heading = await page.locator('h1:has-text("Combos")').count();
      results['S15'] = { pass: heading > 0, detail: `combos heading=${heading > 0}, url=${page.url()}` };
    } catch (e) {
      await page.screenshot({ path: ev('15-FAIL') }).catch(() => {});
      results['S15'] = { pass: false, detail: 'Login/nav: ' + e.message.split('\n')[0] };
    }

    // S16: Create combo
    console.log('--- S16 ---');
    try {
      const createBtn = page.getByRole('button', { name: /create combo/i }).first();
      await createBtn.waitFor({ state: 'visible', timeout: 10000 });
      await createBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: ev('16a-modal-opened') });

      const nameInput = page.locator('input[placeholder*="combo" i], input[placeholder*="fast-coding" i]').first();
      await nameInput.waitFor({ state: 'visible', timeout: 5000 });
      await nameInput.fill('playwright-e2e');

      const modelInputs = page.locator('input[placeholder*="model id" i]');
      await modelInputs.first().fill('canva-image');
      const addModelBtn = page.getByRole('button', { name: /add model/i });
      await addModelBtn.click();
      await page.waitForTimeout(300);
      await modelInputs.nth(1).fill('qd-Auto');

      const stratSelect = page.locator('select').first();
      await stratSelect.selectOption('round-robin');
      await page.waitForTimeout(500);

      const stickyInput = page.locator('input[type="number"]').first();
      await stickyInput.waitFor({ state: 'visible', timeout: 5000 });
      await stickyInput.fill('2');

      await page.screenshot({ path: ev('16b-modal-filled') });

      const submitBtn = page.getByRole('button', { name: /^create combo$/i }).last();
      await submitBtn.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: ev('16c-after-submit') });

      const rowVisible = await page.locator('text=playwright-e2e').count() > 0;
      results['S16'] = { pass: rowVisible, detail: `row visible: ${rowVisible}` };
    } catch (e) {
      await page.screenshot({ path: ev('16-FAIL') }).catch(() => {});
      results['S16'] = { pass: false, detail: 'Create: ' + e.message.split('\n')[0] };
    }

    // S17: Edit
    console.log('--- S17 ---');
    try {
      const row = page.locator('tr', { has: page.locator('text=playwright-e2e') }).first();
      await row.waitFor({ state: 'visible', timeout: 5000 });
      const editBtn = row.locator('button[title="Edit combo"]').first();
      await editBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: ev('17a-edit-modal') });

      const nameInput = page.locator('input[placeholder*="combo" i], input[placeholder*="fast-coding" i]').first();
      const nameDisabled = await nameInput.isDisabled();

      const stratSelect = page.locator('select').first();
      await stratSelect.selectOption('fallback');
      await page.waitForTimeout(500);
      await page.screenshot({ path: ev('17b-edit-filled') });

      const saveBtn = page.getByRole('button', { name: /save changes/i }).first();
      await saveBtn.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: ev('17c-after-save') });

      const updatedRow = page.locator('tr', { has: page.locator('text=playwright-e2e') }).first();
      const fallbackInRow = await updatedRow.locator('text=/fallback/i').count() > 0;
      const stillVisible = await page.locator('text=playwright-e2e').count() > 0;
      results['S17'] = {
        pass: nameDisabled && stillVisible && fallbackInRow,
        detail: `nameDisabled=${nameDisabled}, rowVisible=${stillVisible}, fallbackInRow=${fallbackInRow}`
      };
    } catch (e) {
      await page.screenshot({ path: ev('17-FAIL') }).catch(() => {});
      results['S17'] = { pass: false, detail: 'Edit: ' + e.message.split('\n')[0] };
    }

    // S18: Delete
    console.log('--- S18 ---');
    try {
      const row = page.locator('tr', { has: page.locator('text=playwright-e2e') }).first();
      const delBtn = row.locator('button[title="Delete combo"]').first();
      await delBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: ev('18a-delete-confirm') });
      const confirmBtn = page.getByRole('button', { name: /^delete$/i }).first();
      await confirmBtn.click();
      // Wait specifically for the row in the table to be gone
      await page.waitForTimeout(3000);
      await page.screenshot({ path: ev('18b-after-delete') });

      // Check row is gone (look in tbody specifically, not in toast banner)
      const rowGone = await page.locator('tbody tr:has-text("playwright-e2e")').count() === 0;
      // Also check empty state message
      const emptyState = await page.locator('text="No combos yet"').count() > 0;
      results['S18'] = { pass: rowGone, detail: `row removed: ${rowGone}, emptyState: ${emptyState}` };
    } catch (e) {
      await page.screenshot({ path: ev('18-FAIL') }).catch(() => {});
      results['S18'] = { pass: false, detail: 'Delete: ' + e.message.split('\n')[0] };
    }

    // S19: Settings combo section
    console.log('--- S19 ---');
    try {
      // Sidebar link is labeled "Proxy Settings"
      const settingsLink = page.getByRole('link', { name: /proxy settings/i }).first();
      await settingsLink.click();
      await page.waitForURL(/\/settings/, { timeout: 10000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: ev('19a-settings-loaded') });

      const section = page.locator('text="Combo Settings"').first();
      const sectionVisible = await section.count() > 0;
      if (sectionVisible) await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Locate select right under Global Strategy label inside the combo card.
      // Strategy: find the label element with text "Global Strategy" and use locator near or sibling.
      // Simpler: there are several selects on Settings page. The combo strategy select
      // has options "fallback" and "round-robin" (only). Match by these option values.
      const allSelects = page.locator('select');
      const selectCount = await allSelects.count();
      let stratSelect = null;
      for (let i = 0; i < selectCount; i++) {
        const sel = allSelects.nth(i);
        const opts = await sel.locator('option').allInnerTexts();
        const hasFallback = opts.some(t => /fallback/i.test(t));
        const hasRoundRobin = opts.some(t => /round.?robin/i.test(t));
        if (hasFallback && hasRoundRobin && opts.length === 2) {
          stratSelect = sel;
          break;
        }
      }
      if (!stratSelect) throw new Error('Combo strategy select not found among ' + selectCount + ' selects');

      await stratSelect.selectOption('round-robin');
      await page.waitForTimeout(500);

      // Save the section-finding element for later S20 use via class — store its bounding box
      // For sticky input, look at any input[type=number] near "Sticky Limit" text
      const stickyInput = page.locator('label:has-text("Sticky Limit") + input[type="number"], label:has-text("Sticky Limit") ~ input[type="number"]').first();
      let stickyTarget = stickyInput;
      if (await stickyTarget.count() === 0) {
        // Fallback: any visible number input on settings page near combo section
        stickyTarget = page.locator('input[type="number"]').first();
      }
      await stickyTarget.waitFor({ state: 'visible', timeout: 5000 });
      await stickyTarget.fill('5');
      await page.screenshot({ path: ev('19b-settings-filled') });

      const saveBtn = page.getByRole('button', { name: /save combo settings/i }).first();
      await saveBtn.scrollIntoViewIfNeeded();
      await saveBtn.click();
      await page.waitForTimeout(2500);

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: ev('19c-settings-reloaded') });

      const jwt = fs.readFileSync('.sisyphus/evidence/.jwt', 'utf8').trim();
      const stratResp = await fetch(BASE + '/api/settings/combo_strategy', { headers: { Authorization: 'Bearer ' + jwt } });
      const stratData = await stratResp.json();
      const stickyResp = await fetch(BASE + '/api/settings/combo_sticky_limit', { headers: { Authorization: 'Bearer ' + jwt } });
      const stickyData = await stickyResp.json();
      const persisted = stratData.value === 'round-robin' && (stickyData.value === '5' || stickyData.value === 5);

      results['S19'] = {
        pass: sectionVisible && persisted,
        detail: `sectionVisible=${sectionVisible}, apiStrategy=${stratData.value}, apiSticky=${stickyData.value}`
      };
    } catch (e) {
      await page.screenshot({ path: ev('19-FAIL') }).catch(() => {});
      results['S19'] = { pass: false, detail: 'Settings: ' + e.message.split('\n')[0] };
    }

    // S20: Sticky conditional
    console.log('--- S20 ---');
    try {
      // Find combo strategy select again (by its 2 options matching fallback/round-robin)
      const allSelects = page.locator('select');
      const selectCount = await allSelects.count();
      let stratSelect = null;
      for (let i = 0; i < selectCount; i++) {
        const sel = allSelects.nth(i);
        const opts = await sel.locator('option').allInnerTexts();
        const hasFallback = opts.some(t => /fallback/i.test(t));
        const hasRoundRobin = opts.some(t => /round.?robin/i.test(t));
        if (hasFallback && hasRoundRobin && opts.length === 2) {
          stratSelect = sel;
          break;
        }
      }
      if (!stratSelect) throw new Error('combo strategy select not found');
      await stratSelect.scrollIntoViewIfNeeded();
      await stratSelect.selectOption('fallback');
      await page.waitForTimeout(800);
      await page.screenshot({ path: ev('20a-fallback-selected') });

      // Sticky Limit input is conditionally rendered ONLY when round-robin selected.
      // After fallback, the "Sticky Limit" label and its input should be removed from DOM.
      const stickyLabelCount = await page.locator('label:has-text("Sticky Limit")').count();
      const stickyInputCount = await page.locator('input[type="number"]').count();
      // We need the *combo* sticky input gone. Other number inputs may exist on settings.
      // The conditional is complete removal, so the label "Sticky Limit" should be 0.
      const hidden = stickyLabelCount === 0;
      await page.screenshot({ path: ev('20b-sticky-conditional') });
      results['S20'] = { pass: hidden, detail: `stickyLabelCount=${stickyLabelCount}, anyNumberInputs=${stickyInputCount}, hidden=${hidden}` };
    } catch (e) {
      await page.screenshot({ path: ev('20-FAIL') }).catch(() => {});
      results['S20'] = { pass: false, detail: 'Conditional: ' + e.message.split('\n')[0] };
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== DASHBOARD RESULTS ===');
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'} -- ${v.detail}`);
  }
  if (errs.length > 0) {
    console.log('\nFirst 5 page errors:');
    errs.slice(0, 5).forEach(e => console.log('  ' + e));
  }
  fs.writeFileSync('.sisyphus/evidence/qa-f3-dashboard-summary.json', JSON.stringify({ results, errs: errs.slice(0, 20) }, null, 2));
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
