(() => {
  let toolbar = null;
  let labelPanel = null;
  let selectionCheckInterval = null;
  let labelsCache = null;
  let tornDown = false;
  let filterMode = 'email';
  const BLOCKED_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'yahoo.com', 'yahoo.co.in', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com', 'mail.com',
    'gmx.com', 'gmx.net', 'rediffmail.com',
  ]);

  const DEBUG = true;
  function log(...args) {
    if (DEBUG) console.log('[GFM]', ...args);
  }

  // ---- Extension context guard ----

  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    if (selectionCheckInterval) {
      clearInterval(selectionCheckInterval);
      selectionCheckInterval = null;
    }
    if (toolbar) toolbar.classList.remove('gfm-toolbar-visible');
    showToast('Extension updated — please refresh the page', 'info', {
      text: 'Refresh',
      handler: () => location.reload(),
    });
  }

  // ---- Utility ----

  function sendMsg(msg) {
    if (!isContextValid()) {
      teardown();
      return Promise.reject(new Error('Extension context invalidated'));
    }
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message;
            if (errMsg.includes('Extension context invalidated')) {
              teardown();
            }
            reject(new Error(errMsg));
          } else if (res && res.error) {
            reject(new Error(res.error));
          } else {
            resolve(res);
          }
        });
      } catch (e) {
        if (e.message.includes('Extension context invalidated')) {
          teardown();
        }
        reject(e);
      }
    });
  }

  function showToast(message, type = 'success', action = null) {
    document.querySelectorAll('.gfm-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = `gfm-toast gfm-toast-${type}`;
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (action) {
      const btn = document.createElement('button');
      btn.className = 'gfm-toast-action';
      btn.textContent = action.text;
      btn.addEventListener('click', () => {
        action.handler();
        toast.classList.remove('gfm-toast-show');
        setTimeout(() => toast.remove(), 300);
      });
      toast.appendChild(btn);
      toast.style.pointerEvents = 'auto';
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('gfm-toast-show'));
    const duration = action ? 6000 : 3000;
    setTimeout(() => {
      toast.classList.remove('gfm-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ---- Connected account ----

  async function getConnectedEmail() {
    try {
      const { email } = await sendMsg({ type: 'GET_ACCOUNT_EMAIL' });
      return email;
    } catch (e) {
      log('Failed to get account email:', e);
      return null;
    }
  }

  // ---- Gmail DOM helpers ----

  function getSelectedRows() {
    const mainArea = document.querySelector('div[role="main"]');
    if (!mainArea) return [];

    // Strategy 1: aria-checked checkboxes
    const checkboxes = mainArea.querySelectorAll('[role="checkbox"][aria-checked="true"]');
    if (checkboxes.length > 0) {
      const rows = [...checkboxes].map(cb => cb.closest('tr')).filter(Boolean);
      if (rows.length > 0) return rows;
    }

    // Strategy 2: scan rows for checked checkboxes
    const allRows = mainArea.querySelectorAll('tr');
    const selectedRows = [];
    for (const row of allRows) {
      const cb = row.querySelector('[role="checkbox"]');
      if (cb && cb.getAttribute('aria-checked') === 'true') {
        selectedRows.push(row);
      }
    }
    if (selectedRows.length > 0) return selectedRows;

    // Strategy 3: legacy Gmail class
    const legacyChecked = mainArea.querySelectorAll('.T-Jo-checked');
    if (legacyChecked.length > 0) {
      return [...legacyChecked].map(cb => cb.closest('tr')).filter(Boolean);
    }

    return [];
  }

  function getSendersFromRows() {
    const rows = getSelectedRows();
    const senders = new Set();

    for (const row of rows) {
      const senderEls = row.querySelectorAll('span[email]');
      for (const el of senderEls) {
        const email = el.getAttribute('email');
        if (email) senders.add(email.toLowerCase());
      }
      // Fallback: data-hovercard-id
      if (senderEls.length === 0) {
        const hovercard = row.querySelectorAll('[data-hovercard-id]');
        for (const el of hovercard) {
          const id = el.getAttribute('data-hovercard-id');
          if (id && id.includes('@')) senders.add(id.toLowerCase());
        }
      }
    }

    return [...senders];
  }

  function getDomainsFromRows() {
    const senders = getSendersFromRows();
    const domains = new Set();
    for (const email of senders) {
      const atIdx = email.indexOf('@');
      if (atIdx !== -1) {
        const domain = email.slice(atIdx + 1);
        if (!BLOCKED_DOMAINS.has(domain)) {
          domains.add(`*@${domain}`);
        }
      }
    }
    return [...domains];
  }

  function countBlockedDomains() {
    const senders = getSendersFromRows();
    let blocked = 0;
    const seen = new Set();
    for (const email of senders) {
      const atIdx = email.indexOf('@');
      if (atIdx !== -1) {
        const domain = email.slice(atIdx + 1);
        if (!seen.has(domain)) {
          seen.add(domain);
          if (BLOCKED_DOMAINS.has(domain)) blocked++;
        }
      }
    }
    return blocked;
  }

  // ---- Load labels ----

  async function loadLabels() {
    // Ensure we fetch labels for the account matching this Gmail tab
    const pageEmail = getGmailPageEmail();
    if (pageEmail) {
      await sendMsg({ type: 'SWITCH_ACCOUNT', email: pageEmail });
    }
    const { labels } = await sendMsg({ type: 'GET_LABELS' });
    labelsCache = labels;
    return labels;
  }

  // ---- Toolbar ----

  function createToolbar() {
    if (toolbar) return;

    toolbar = document.createElement('div');
    toolbar.id = 'gfm-toolbar';
    toolbar.innerHTML = `
      <div class="gfm-toolbar-topbar">
        <span class="gfm-account-indicator"></span>
        <div class="gfm-toolbar-links">
          <a href="https://gmailfiltermanager.com/#privacy" target="_blank">Runs locally · Everything between you & Gmail · No external servers</a>
        </div>
      </div>
      <div class="gfm-toolbar-inner">
        <span class="gfm-selection-count">0 selected</span>
        <div class="gfm-mode-toggle">
          <button class="gfm-mode-btn active" data-mode="email">Email</button>
          <button class="gfm-mode-btn" data-mode="domain">Domain</button>
        </div>
        <div class="gfm-divider"></div>
        <div class="gfm-toolbar-options">
          <label class="gfm-toolbar-check">
            <input type="checkbox" id="gfm-opt-read" checked>
            <span>Mark Read</span>
          </label>
          <label class="gfm-toolbar-check">
            <input type="checkbox" id="gfm-opt-archive">
            <span>Archive</span>
          </label>
          <label class="gfm-toolbar-check">
            <input type="checkbox" id="gfm-opt-delete">
            <span>Delete</span>
          </label>
          <div class="gfm-label-wrap">
            <label class="gfm-toolbar-check">
              <input type="checkbox" id="gfm-opt-label">
              <span>Label</span>
            </label>
            <select id="gfm-label-select" class="gfm-label-select" disabled>
              <option value="">Select...</option>
            </select>
          </div>
        </div>
        <div class="gfm-divider"></div>
        <button class="gfm-btn gfm-btn-filter" id="gfm-create-filter-btn" title="Create Filter">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          <span>Create Filter</span>
        </button>
      </div>
    `;

    document.body.appendChild(toolbar);

    // --- Event bindings ---

    // Delete deselects and disables all other options
    const deleteCheck = toolbar.querySelector('#gfm-opt-delete');
    const readCheck = toolbar.querySelector('#gfm-opt-read');
    const archiveCheck = toolbar.querySelector('#gfm-opt-archive');
    const labelCheck = toolbar.querySelector('#gfm-opt-label');
    const labelSelect = toolbar.querySelector('#gfm-label-select');
    deleteCheck.addEventListener('change', () => {
      if (deleteCheck.checked) {
        readCheck.checked = false;
        readCheck.disabled = true;
        archiveCheck.checked = false;
        archiveCheck.disabled = true;
        labelCheck.checked = false;
        labelCheck.disabled = true;
        labelSelect.disabled = true;
      } else {
        readCheck.disabled = false;
        archiveCheck.disabled = false;
        labelCheck.disabled = false;
      }
    });

    // Label checkbox toggles select
    labelCheck.addEventListener('change', async () => {
      labelSelect.disabled = !labelCheck.checked;
      if (labelCheck.checked) {
        // Always reload labels to ensure correct account
        try {
          const labels = await loadLabels();
          labelSelect.innerHTML = '<option value="">Select...</option>' +
            labels.map(l => `<option value="${l.id}">${l.name}</option>`).join('') +
            '<option value="__new__">+ New label</option>';
        } catch (err) {
          log('Failed to load labels:', err);
        }
      }
    });

    // Mode toggle (Email / Domain)
    const tooltipTexts = {
      email: 'Filter by exact sender address\ne.g. newsletter@company.com',
      domain: 'Filter all addresses from a domain\ne.g. *@company.com\n\nCommon providers (gmail.com, outlook.com,\nyahoo.com, etc.) are automatically skipped',
    };
    toolbar.querySelectorAll('.gfm-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.gfm-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterMode = btn.dataset.mode;
        updateToolbarCount();
      });

      const tip = document.createElement('div');
      tip.className = 'gfm-tooltip';
      tip.textContent = tooltipTexts[btn.dataset.mode];
      btn.appendChild(tip);
    });

    // Create Filter button
    toolbar.querySelector('#gfm-create-filter-btn').addEventListener('click', handleCreateFilter);

    // Prevent toolbar clicks from propagating to Gmail
    toolbar.addEventListener('click', (e) => e.stopPropagation());

    // Show which account filters will target, validating with Google
    const pageEmail = getGmailPageEmail();
    sendMsg({ type: 'GET_ACCOUNTS' }).then(async ({ accounts }) => {
      const indicator = toolbar.querySelector('.gfm-account-indicator');
      if (!indicator) return;
      const match = accounts && accounts.find(a => a.email === pageEmail);
      if (match) {
        // Validate that the token is still valid with Google
        const { valid } = await sendMsg({ type: 'VALIDATE_ACCOUNT', email: pageEmail });
        if (valid) {
          indicator.textContent = `Filters for: ${pageEmail}`;
        } else {
          indicator.textContent = `${pageEmail} (not connected)`;
        }
      } else if (pageEmail) {
        indicator.textContent = `${pageEmail} (not connected)`;
      } else {
        getConnectedEmail().then(email => {
          if (email) indicator.textContent = `Filters for: ${email}`;
        });
      }
    }).catch(() => {
      getConnectedEmail().then(email => {
        const indicator = toolbar.querySelector('.gfm-account-indicator');
        if (email && indicator) indicator.textContent = `Filters for: ${email}`;
      });
    });
  }

  function updateToolbarCount() {
    if (!toolbar) return;
    const countEl = toolbar.querySelector('.gfm-selection-count');
    if (filterMode === 'domain') {
      const domains = getDomainsFromRows();
      const blocked = countBlockedDomains();
      let text = `${domains.length} domain${domains.length !== 1 ? 's' : ''}`;
      if (blocked > 0) text += ` (${blocked} common provider${blocked !== 1 ? 's' : ''} skipped)`;
      countEl.textContent = text;
    } else {
      const count = getSelectedRows().length;
      countEl.textContent = `${count} selected`;
    }
  }

  function showToolbar(count) {
    if (!toolbar) createToolbar();
    updateToolbarCount();
    toolbar.classList.add('gfm-toolbar-visible');
  }

  function hideToolbar() {
    if (toolbar) {
      toolbar.classList.remove('gfm-toolbar-visible');
    }
    hideLabelPanel();
  }

  // ---- Create Filter handler ----

  async function handleCreateFilter() {
    // Detect which Gmail account the user is viewing
    const pageEmail = getGmailPageEmail();
    let connectedEmail = await getConnectedEmail();

    if (pageEmail) {
      // Check if the page's account is connected AND still valid with Google
      const { accounts } = await sendMsg({ type: 'GET_ACCOUNTS' });
      const pageAccountListed = accounts && accounts.some(a => a.email === pageEmail);

      let pageAccountValid = false;
      if (pageAccountListed) {
        const { valid } = await sendMsg({ type: 'VALIDATE_ACCOUNT', email: pageEmail });
        pageAccountValid = valid;
      }

      if (!pageAccountValid) {
        // Account not connected or access was revoked — trigger OAuth
        const reason = pageAccountListed ? 'access revoked' : 'not connected';
        showToast(`Account ${pageEmail} ${reason} — starting Google sign-in...`, 'info');
        try {
          const result = await sendMsg({ type: 'ADD_ACCOUNT' });
          connectedEmail = result.email;
          // Ensure the newly added account is active before creating filters
          await sendMsg({ type: 'SWITCH_ACCOUNT', email: connectedEmail });
          showToast(`Connected as ${connectedEmail}`, 'success');
          const indicator = document.querySelector('.gfm-account-indicator');
          if (indicator) indicator.textContent = `Filters for: ${connectedEmail}`;
        } catch (err) {
          showToast(`Failed to connect account: ${err.message}`, 'error');
          return;
        }
      } else if (connectedEmail !== pageEmail) {
        // Account is connected and valid but not active — switch to it
        await sendMsg({ type: 'SWITCH_ACCOUNT', email: pageEmail });
        connectedEmail = pageEmail;
        showToast(`Switched to ${pageEmail}`, 'info');
        const indicator = document.querySelector('.gfm-account-indicator');
        if (indicator) indicator.textContent = `Filters for: ${connectedEmail}`;
      }
    } else if (!connectedEmail) {
      // Can't detect page email and no account connected at all
      showToast('No account connected — starting Google sign-in...', 'info');
      try {
        const result = await sendMsg({ type: 'ADD_ACCOUNT' });
        connectedEmail = result.email;
        await sendMsg({ type: 'SWITCH_ACCOUNT', email: connectedEmail });
        showToast(`Connected as ${connectedEmail}`, 'success');
        const indicator = document.querySelector('.gfm-account-indicator');
        if (indicator) indicator.textContent = `Filters for: ${connectedEmail}`;
      } catch (err) {
        showToast(`Failed to connect account: ${err.message}`, 'error');
        return;
      }
    }

    const senders = filterMode === 'domain' ? getDomainsFromRows() : getSendersFromRows();
    if (senders.length === 0) {
      if (filterMode === 'domain') {
        showToast('Cannot filter common email providers (gmail.com, outlook.com, etc.)', 'error');
      } else {
        showToast('Could not extract sender emails from selection', 'error');
      }
      return;
    }

    // Build action from toolbar checkboxes
    const action = {};
    const tb = toolbar;

    if (tb.querySelector('#gfm-opt-read').checked) {
      action.removeLabelIds = action.removeLabelIds || [];
      action.removeLabelIds.push('UNREAD');
    }
    if (tb.querySelector('#gfm-opt-archive').checked) {
      action.removeLabelIds = action.removeLabelIds || [];
      action.removeLabelIds.push('INBOX');
    }
    if (tb.querySelector('#gfm-opt-delete').checked) {
      action.addLabelIds = action.addLabelIds || [];
      action.addLabelIds.push('TRASH');
    }

    const labelCheck = tb.querySelector('#gfm-opt-label');
    const labelSelect = tb.querySelector('#gfm-label-select');
    if (labelCheck.checked && labelSelect.value) {
      let labelId = labelSelect.value;

      if (labelId === '__new__') {
        const name = prompt('Enter new label name:');
        if (!name) return;
        try {
          const { label } = await sendMsg({ type: 'CREATE_LABEL', name });
          labelId = label.id;
          // Add to dropdown
          const opt = document.createElement('option');
          opt.value = label.id;
          opt.textContent = name;
          labelSelect.insertBefore(opt, labelSelect.lastElementChild);
          labelSelect.value = label.id;
          labelsCache = null; // invalidate cache
        } catch (err) {
          showToast(`Failed to create label: ${err.message}`, 'error');
          return;
        }
      }

      action.addLabelIds = action.addLabelIds || [];
      action.addLabelIds.push(labelId);
    }

    if (Object.keys(action).length === 0) {
      showToast('Select at least one action', 'error');
      return;
    }

    // Disable button while creating
    const btn = tb.querySelector('#gfm-create-filter-btn');
    btn.disabled = true;
    const origText = btn.querySelector('span').textContent;
    btn.querySelector('span').textContent = 'Creating...';

    try {
      const result = await sendMsg({
        type: 'CREATE_FILTER',
        senders,
        filterAction: action
      });

      const word = result.action === 'updated' ? 'Updated' : result.action === 'overflow' ? 'Created overflow' : 'Created';

      // Always apply to existing emails
      try {
        await sendMsg({ type: 'APPLY_FILTER_TO_EXISTING', senders, filterAction: action });
        showToast('Filter created & applied to existing emails');
        updateVisibleRows(action);
      } catch (e) {
        log('Apply to existing failed:', e);
        showToast(`${word} filter for ${senders.length} sender(s)`);
      }

    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = origText;
    }
  }

  // ---- Label panel (kept for potential future use) ----

  function hideLabelPanel() {
    if (labelPanel) {
      labelPanel.classList.remove('gfm-panel-visible');
      setTimeout(() => {
        if (labelPanel) {
          labelPanel.remove();
          labelPanel = null;
        }
      }, 300);
    }
  }

  // ---- Visual update after filter applied ----

  function updateVisibleRows(filterAction) {
    const rows = getSelectedRows();
    if (rows.length === 0) return;

    const removeLabels = filterAction.removeLabelIds || [];
    const addLabels = filterAction.addLabelIds || [];
    const shouldHide = removeLabels.includes('INBOX') || addLabels.includes('TRASH');

    if (shouldHide) {
      // Archive or Delete — fade out and remove rows
      for (const row of rows) {
        row.style.transition = 'opacity 0.3s ease, max-height 0.3s ease';
        row.style.opacity = '0';
        row.style.maxHeight = row.offsetHeight + 'px';
        row.style.overflow = 'hidden';
        setTimeout(() => {
          row.style.maxHeight = '0';
          row.style.padding = '0';
          setTimeout(() => row.remove(), 300);
        }, 300);
      }
      log('Hid', rows.length, 'rows (archive/delete)');
    } else if (removeLabels.includes('UNREAD')) {
      // Mark as read — unbold everything in the row
      for (const row of rows) {
        row.querySelectorAll('*').forEach(el => {
          const fw = getComputedStyle(el).fontWeight;
          if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900') {
            el.style.fontWeight = 'normal';
          }
        });
        // Replace <b> tags with their text content
        row.querySelectorAll('b').forEach(b => {
          const span = document.createElement('span');
          span.innerHTML = b.innerHTML;
          b.replaceWith(span);
        });
      }
      log('Marked', rows.length, 'rows as read visually');
    }
  }

  // ---- Selection observer (polling only) ----

  function startSelectionObserver() {
    if (selectionCheckInterval) return;

    log('Starting selection observer');

    let lastCount = 0;

    selectionCheckInterval = setInterval(() => {
      if (!isContextValid()) { teardown(); return; }
      const selected = getSelectedRows();
      if (selected.length > 0) {
        if (selected.length !== lastCount) {
          log('Selection changed:', selected.length);
        }
        lastCount = selected.length;
        showToolbar(selected.length);
      } else if (lastCount > 0) {
        lastCount = 0;
        hideToolbar();
      }
    }, 500);

    log('Selection observer started');
  }

  // ---- Detect current Gmail page email ----

  function getGmailPageEmail() {
    // Try data-email attribute (profile area)
    const emailEl = document.querySelector('[data-email]');
    if (emailEl) return emailEl.getAttribute('data-email').toLowerCase();

    // Try from page title: "Inbox (3) - user@gmail.com - Gmail"
    const titleMatch = document.title.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (titleMatch) return titleMatch[0].toLowerCase();

    return null;
  }

  // ---- Listen for messages ----

  if (isContextValid()) chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isContextValid()) return;
    if (msg.type === 'GET_GMAIL_PAGE_EMAIL') {
      sendResponse({ email: getGmailPageEmail() });
      return;
    }
    if (msg.type === 'ACTIVE_ACCOUNT_CHANGED') {
      log('Active account changed to:', msg.email);
      // Update toolbar indicator
      const indicator = document.querySelector('.gfm-account-indicator');
      if (indicator) {
        indicator.textContent = msg.email ? `Filters for: ${msg.email}` : '';
      }
      // Clear labels cache (labels are per-account)
      labelsCache = null;
    }
  });

  // ---- Init ----

  function init() {
    log('Gmail Filter Manager initializing...');

    const checkReady = setInterval(() => {
      if (!isContextValid()) { clearInterval(checkReady); return; }
      const main = document.querySelector('div[role="main"]');
      if (main) {
        clearInterval(checkReady);
        log('Gmail loaded, starting observers');
        startSelectionObserver();
        showToast('Gmail Filter Manager loaded', 'info');
      }
    }, 1000);
  }

  init();
})();
