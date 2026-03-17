function sendMsg(msg, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        reject(new Error('Background script not responding. Try reloading the extension.'));
      }, timeoutMs);
    }
    chrome.runtime.sendMessage(msg, (res) => {
      if (timer) clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (res && res.error) {
        reject(new Error(res.error));
      } else {
        resolve(res);
      }
    });
  });
}

function getActionBadges(action) {
  const badges = [];
  if (action.removeLabelIds) {
    if (action.removeLabelIds.includes('UNREAD')) badges.push({ text: 'Mark Read', class: 'badge-read' });
    if (action.removeLabelIds.includes('INBOX')) badges.push({ text: 'Archive', class: 'badge-archive' });
    if (action.removeLabelIds.includes('IMPORTANT')) badges.push({ text: 'Not Important', class: 'badge-important' });
  }
  if (action.addLabelIds) {
    if (action.addLabelIds.includes('TRASH')) badges.push({ text: 'Delete', class: 'badge-delete' });
    if (action.addLabelIds.includes('STARRED')) badges.push({ text: 'Star', class: 'badge-star' });
    const customLabels = action.addLabelIds.filter(id => !['TRASH', 'STARRED'].includes(id));
    for (const labelId of customLabels) {
      badges.push({ text: `Label: ${labelId}`, class: 'badge-label' });
    }
  }
  return badges;
}

async function loadFilterGroups() {
  const container = document.getElementById('filter-groups-container');

  try {
    // Check if any account is connected first
    const { accounts } = await sendMsg({ type: 'GET_ACCOUNTS' });
    if (!accounts || accounts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <p>No account connected.<br>Select emails in Gmail and click <strong>Create Filter</strong> to sign in.</p>
        </div>
      `;
      return;
    }

    const { groups } = await sendMsg({ type: 'GET_FILTER_GROUPS' });

    if (!groups || groups.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          <p>No filter groups yet.<br>Select emails in Gmail and use the toolbar to create filters.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = groups.map((group, i) => {
      const badges = getActionBadges(group.action);
      const senderCount = group.senders ? group.senders.length : 0;

      return `
        <div class="filter-group" data-index="${i}">
          <div class="filter-group-header">
            <div class="filter-action-badges">
              ${badges.map(b => `<span class="action-badge ${b.class}">${b.text}</span>`).join('')}
            </div>
            <button class="delete-group-btn" data-action-key='${group.actionKey}' title="Delete this filter group">&times;</button>
          </div>
          <div class="filter-senders-count">${senderCount} sender${senderCount !== 1 ? 's' : ''}</div>
          <button class="toggle-senders" data-index="${i}">Show senders</button>
          <div class="filter-senders-list" id="senders-${i}">
            ${(group.senders || []).map(s => `
              <div class="filter-sender-item">
                <span>${s}</span>
                <button class="filter-sender-remove" data-action-key='${group.actionKey}' data-sender="${s}" title="Remove sender">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Toggle senders
    container.querySelectorAll('.toggle-senders').forEach(btn => {
      btn.addEventListener('click', () => {
        const list = document.getElementById(`senders-${btn.dataset.index}`);
        const expanded = list.classList.toggle('expanded');
        btn.textContent = expanded ? 'Hide senders' : 'Show senders';
      });
    });

    // Remove individual sender
    container.querySelectorAll('.filter-sender-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove ${btn.dataset.sender} from this filter?`)) return;
        try {
          await sendMsg({
            type: 'REMOVE_SENDER_FROM_GROUP',
            actionKey: btn.dataset.actionKey,
            sender: btn.dataset.sender
          });
          loadFilterGroups();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    });

    // Delete entire group
    container.querySelectorAll('.delete-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this entire filter group? This will remove the Gmail filter.')) return;
        try {
          await sendMsg({
            type: 'DELETE_FILTER_GROUP',
            actionKey: btn.dataset.actionKey
          });
          loadFilterGroups();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    });

  } catch (err) {
    console.error('[GFM Popup] loadFilterGroups error:', err);
    container.innerHTML = `<div class="loading" style="color: #c5221f;">Error: ${err.message}</div>`;
  }
}

async function renderAccounts() {
  const container = document.getElementById('accounts-list');
  try {
    const { accounts, activeEmail } = await sendMsg({ type: 'GET_ACCOUNTS' });

    if (!accounts || accounts.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 10px 0;">
          <p style="font-size: 13px; color: #5f6368;">No account connected.<br>Select emails in Gmail and click <strong>Create Filter</strong> to sign in.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = accounts.map(a => {
      const isActive = a.email === activeEmail;
      return `
        <div class="account-item${isActive ? ' active' : ''}" data-email="${a.email}">
          <span class="account-email">${a.email}</span>
          ${isActive ? '<span class="account-active-badge">Active</span>' : ''}
          <button class="account-remove-btn" data-email="${a.email}" title="Remove account">&times;</button>
        </div>
      `;
    }).join('');

    // Click to switch account
    container.querySelectorAll('.account-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('account-remove-btn')) return;
        const email = item.dataset.email;
        try {
          await sendMsg({ type: 'SWITCH_ACCOUNT', email });
          renderAccounts();
          loadFilterGroups();
        } catch (err) {
          alert(`Error switching account: ${err.message}`);
        }
      });
    });

    // Remove account
    container.querySelectorAll('.account-remove-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const email = btn.dataset.email;
        if (!confirm(`Remove account ${email}?`)) return;
        try {
          await sendMsg({ type: 'REMOVE_ACCOUNT', email });
          renderAccounts();
          loadFilterGroups();
        } catch (err) {
          alert(`Error removing account: ${err.message}`);
        }
      });
    });

  } catch (err) {
    console.error('[GFM Popup] renderAccounts error:', err);
    container.innerHTML = `<div style="font-size: 12px; color: #c5221f; padding: 4px 0;">Error: ${err.message}</div>`;
  }
}

// Open Gmail filters settings — navigate the active Gmail tab directly
document.getElementById('open-gmail-filters').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('mail.google.com')) {
      const base = tab.url.replace(/#.*$/, '');
      chrome.tabs.update(tab.id, { url: base + '#settings/filters' });
    } else {
      chrome.tabs.create({ url: 'https://mail.google.com/mail/#settings/filters' });
    }
  });
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', () => {
  loadFilterGroups();
});

// Init
renderAccounts();
loadFilterGroups();
