const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const FILTER_CHAR_LIMIT = 1400;

const CLIENT_ID = '699821877875-2hfmeheqimofm92gvjvhqhck9o3bmvp0.apps.googleusercontent.com';
const CLIENT_SECRET = 'REMOVED';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');
const REDIRECT_URL = chrome.identity.getRedirectURL();
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ---- PKCE helpers ----

function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- OAuth flow ----

async function launchOAuthFlow() {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URL,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    access_type: 'offline'
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  const redirectResult = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(redirectUrl);
        }
      }
    );
  });

  const url = new URL(redirectResult);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code received');

  // Exchange code for tokens
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URL
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return tokenRes.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) return null;
  return res.json();
}

// ---- Account CRUD ----

async function getAccounts() {
  return new Promise((resolve) => {
    chrome.storage.local.get('accounts', (data) => {
      resolve(data.accounts || []);
    });
  });
}

async function saveAccounts(accounts) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ accounts }, resolve);
  });
}

async function getActiveAccountEmail() {
  return new Promise((resolve) => {
    chrome.storage.local.get('activeAccountEmail', (data) => {
      resolve(data.activeAccountEmail || null);
    });
  });
}

async function setActiveAccountEmail(email) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ activeAccountEmail: email }, resolve);
  });
}

async function getValidTokenForActiveAccount() {
  const accounts = await getAccounts();
  const activeEmail = await getActiveAccountEmail();
  if (!activeEmail || accounts.length === 0) {
    throw new Error('No account connected. Please add an account.');
  }

  const account = accounts.find(a => a.email === activeEmail);
  if (!account) {
    throw new Error(`Active account ${activeEmail} not found. Please add an account.`);
  }

  // Check if token is still valid (with 60s buffer)
  if (account.expiresAt && Date.now() < account.expiresAt - 60000) {
    return account.accessToken;
  }

  // Token expired, try refresh
  if (!account.refreshToken) {
    throw new Error('No refresh token available. Please re-add your account.');
  }

  const tokenData = await refreshAccessToken(account.refreshToken);
  if (!tokenData) {
    throw new Error('Token refresh failed. Please re-add your account.');
  }

  // Update stored account
  account.accessToken = tokenData.access_token;
  account.expiresAt = Date.now() + (tokenData.expires_in * 1000);
  if (tokenData.refresh_token) {
    account.refreshToken = tokenData.refresh_token;
  }
  await saveAccounts(accounts);

  return account.accessToken;
}

async function addAccount() {
  const tokenData = await launchOAuthFlow();

  // Fetch user email
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
  });
  if (!userInfoRes.ok) throw new Error('Failed to fetch user info');
  const userInfo = await userInfoRes.json();
  const email = userInfo.email.toLowerCase();

  const accounts = await getAccounts();
  const existing = accounts.findIndex(a => a.email === email);

  const accountEntry = {
    email,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000),
    addedAt: Date.now()
  };

  if (existing >= 0) {
    accounts[existing] = accountEntry;
  } else {
    accounts.push(accountEntry);
  }

  await saveAccounts(accounts);

  // Set as active if first account
  const activeEmail = await getActiveAccountEmail();
  if (!activeEmail || accounts.length === 1) {
    await setActiveAccountEmail(email);
  }

  return email;
}

async function removeAccount(email) {
  const accounts = await getAccounts();
  const account = accounts.find(a => a.email === email);

  // Best-effort revoke token
  if (account && account.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${account.accessToken}`, {
        method: 'POST'
      });
    } catch (e) { /* best effort */ }
  }

  const filtered = accounts.filter(a => a.email !== email);
  await saveAccounts(filtered);

  const activeEmail = await getActiveAccountEmail();
  if (activeEmail === email) {
    await setActiveAccountEmail(filtered.length > 0 ? filtered[0].email : null);
  }
}

// ---- Delegates for downstream callers ----

async function getAuthenticatedEmail() {
  return getActiveAccountEmail();
}

// ---- Gmail API request ----

const GMAIL_ERROR_REASONS = {
  notFound: 'Filter not found — it may have been deleted',
  invalidArgument: 'Invalid filter criteria — check your sender addresses',
  quotaExceeded: 'Gmail rate limit reached — please wait a moment and try again',
  authError: 'Authentication expired — please reconnect your account',
  failedPrecondition: 'Gmail rejected this change — the filter may conflict with an existing one',
  resourceAlreadyExists: 'A filter with these exact criteria already exists',
};

function parseGmailError(status, rawText) {
  try {
    const json = JSON.parse(rawText);
    const err = json.error;
    if (err) {
      // Check for known reason codes
      if (err.errors && err.errors.length > 0) {
        const reason = err.errors[0].reason;
        if (GMAIL_ERROR_REASONS[reason]) return GMAIL_ERROR_REASONS[reason];
      }
      // Fall back to the top-level message
      if (err.message) return err.message;
    }
  } catch (_) {
    // Not JSON — use raw text if short enough
  }
  if (rawText.length <= 120) return rawText;
  return `Gmail request failed (${status})`;
}

async function gmailRequest(endpoint, options = {}) {
  const token = await getValidTokenForActiveAccount();
  const url = endpoint.startsWith('http') ? endpoint : `${GMAIL_API}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const rawErr = await res.text();
    console.error(`[GFM Background] Gmail API ${res.status} on ${endpoint}:`, rawErr);
    throw new Error(parseGmailError(res.status, rawErr));
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Search for message IDs by sender ----

async function searchMessages(query, maxResults = 100) {
  const data = await gmailRequest(`/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`);
  return (data.messages || []).map(m => m.id);
}

async function getMessageIdsFromThreads(threadIds) {
  const messageIds = [];
  for (const threadId of threadIds) {
    try {
      const thread = await gmailRequest(`/threads/${threadId}?format=minimal`);
      for (const msg of thread.messages) {
        messageIds.push(msg.id);
      }
    } catch (e) {
      console.warn('Failed to get thread', threadId, e);
    }
  }
  return messageIds;
}

// ---- Batch modify with proper message IDs ----

async function batchModify(messageIds, addLabelIds = [], removeLabelIds = []) {
  if (messageIds.length === 0) return;
  // Gmail batch modify supports max 1000 IDs
  for (let i = 0; i < messageIds.length; i += 1000) {
    const batch = messageIds.slice(i, i + 1000);
    await gmailRequest('/messages/batchModify', {
      method: 'POST',
      body: JSON.stringify({
        ids: batch,
        addLabelIds,
        removeLabelIds
      })
    });
  }
}

async function batchDelete(messageIds) {
  if (messageIds.length === 0) return;
  for (let i = 0; i < messageIds.length; i += 1000) {
    const batch = messageIds.slice(i, i + 1000);
    await gmailRequest('/messages/batchDelete', {
      method: 'POST',
      body: JSON.stringify({ ids: batch })
    });
  }
}

// ---- Perform action using sender search ----

async function actionBySenders(senders, actionType) {
  // Build search query for all senders
  const query = senders.map(s => `from:${s}`).join(' OR ');
  // Only get recent (inbox) messages to avoid mass operations
  const messageIds = await searchMessages(`(${query}) in:inbox`, 50);

  if (messageIds.length === 0) {
    // Try without inbox restriction
    const allIds = await searchMessages(`(${query})`, 50);
    if (allIds.length === 0) throw new Error('No messages found from these senders');
    return performAction(allIds, actionType);
  }

  return performAction(messageIds, actionType);
}

async function actionByThreads(threadIds, actionType) {
  const messageIds = await getMessageIdsFromThreads(threadIds);
  if (messageIds.length === 0) throw new Error('No messages found in these threads');
  return performAction(messageIds, actionType);
}

async function performAction(messageIds, actionType) {
  switch (actionType) {
    case 'read':
      await batchModify(messageIds, [], ['UNREAD']);
      break;
    case 'archive':
      await batchModify(messageIds, [], ['INBOX']);
      break;
    case 'delete':
      await batchDelete(messageIds);
      break;
    default:
      throw new Error(`Unknown action: ${actionType}`);
  }
  return { success: true, count: messageIds.length };
}

async function labelBySenders(senders, labelId) {
  const query = senders.map(s => `from:${s}`).join(' OR ');
  const messageIds = await searchMessages(`(${query})`, 50);
  if (messageIds.length === 0) throw new Error('No messages found from these senders');
  await batchModify(messageIds, [labelId], []);
  return { success: true, count: messageIds.length };
}

async function labelByThreads(threadIds, labelId) {
  const messageIds = await getMessageIdsFromThreads(threadIds);
  if (messageIds.length === 0) throw new Error('No messages found');
  await batchModify(messageIds, [labelId], []);
  return { success: true, count: messageIds.length };
}

// ---- Apply filter to existing emails ----

async function applyFilterToExisting(senders, filterAction) {
  const query = senders.map(s => `from:${s}`).join(' OR ');
  const messageIds = await searchMessages(`(${query})`, 500);
  if (messageIds.length === 0) return { success: true, count: 0 };

  const addLabels = filterAction.addLabelIds || [];
  const removeLabels = filterAction.removeLabelIds || [];

  const doModify = async () => {
    if (addLabels.includes('TRASH')) {
      await batchModify(messageIds, ['TRASH'], removeLabels);
    } else {
      await batchModify(messageIds, addLabels, removeLabels);
    }
  };

  // Retry once after a short delay if label propagation hasn't settled
  try {
    await doModify();
  } catch (e) {
    if (e.message.includes('does not exist')) {
      console.warn('[GFM Background] Label not ready, retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
      await doModify();
    } else {
      throw e;
    }
  }

  return { success: true, count: messageIds.length };
}

// ---- Label operations ----

async function getLabels() {
  const data = await gmailRequest('/labels');
  return data.labels.filter(l => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
}

async function createLabel(name) {
  return gmailRequest('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    })
  });
}

// ---- Filter operations ----

async function getFilters() {
  const data = await gmailRequest('/settings/filters');
  return data.filter || [];
}

async function createFilter(criteria, action) {
  return gmailRequest('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({ criteria, action })
  });
}

async function deleteFilter(filterId) {
  return gmailRequest(`/settings/filters/${filterId}`, {
    method: 'DELETE'
  });
}

async function updateFilter(filterId, criteria, action) {
  // Create new filter first so we never lose the old one if creation fails
  const newFilter = await createFilter(criteria, action);
  try {
    await deleteFilter(filterId);
  } catch (e) {
    // Old filter couldn't be deleted (maybe already gone) — not critical since new one is in place
    console.warn('[GFM Background] Could not delete old filter', filterId, e.message);
  }
  return newFilter;
}

function actionsMatch(a, b) {
  const normalize = (obj) => {
    const sorted = {};
    for (const k of Object.keys(obj).sort()) {
      if (obj[k] !== undefined && k !== 'forward') {
        sorted[k] = Array.isArray(obj[k]) ? [...obj[k]].sort() : obj[k];
      }
    }
    return JSON.stringify(sorted);
  };
  return normalize(a) === normalize(b);
}

async function smartCreateFilter(senders, filterAction) {
  let existingFilters;
  try {
    existingFilters = await getFilters();
  } catch (e) {
    console.warn('[GFM Background] Could not fetch existing filters, skipping merge:', e.message);
    existingFilters = [];
  }

  const newFrom = senders.map(s => s.toLowerCase());

  // Find existing filters with the same action
  let matchedFilter = null;
  for (const f of existingFilters) {
    if (f.action && actionsMatch(f.action, filterAction)) {
      if (f.criteria && f.criteria.from) {
        matchedFilter = f;
        break;
      }
    }
  }

  if (matchedFilter) {
    const existingFrom = parseFromCriteria(matchedFilter.criteria.from);
    const allSenders = [...new Set([...existingFrom, ...newFrom])];
    const newCriteria = buildFromCriteria(allSenders);

    if (newCriteria.length <= FILTER_CHAR_LIMIT) {
      try {
        const result = await updateFilter(matchedFilter.id, { from: newCriteria }, filterAction);
        await saveFilterGroup(filterAction, matchedFilter.id, result.id, allSenders);
        return { action: 'updated', filterIds: [result.id], senders: allSenders };
      } catch (e) {
        // Merge failed (stale filter, API rejected merged criteria, etc.) — fall back to new filter
        console.warn('[GFM Background] Update failed, creating new filter instead:', e.message);
        const criteria = buildFromCriteria(newFrom);
        const result = await createFilter({ from: criteria }, filterAction);
        await addToFilterGroup(filterAction, result.id, newFrom);
        return { action: 'created', filterIds: [result.id], senders: newFrom };
      }
    } else {
      const overflowCriteria = buildFromCriteria(newFrom);
      const result = await createFilter({ from: overflowCriteria }, filterAction);
      await addToFilterGroup(filterAction, result.id, newFrom);
      return { action: 'overflow', filterIds: [matchedFilter.id, result.id], senders: newFrom };
    }
  } else {
    const criteria = buildFromCriteria(newFrom);
    const result = await createFilter({ from: criteria }, filterAction);
    await addToFilterGroup(filterAction, result.id, newFrom);
    return { action: 'created', filterIds: [result.id], senders: newFrom };
  }
}

function parseFromCriteria(fromStr) {
  let cleaned = fromStr.replace(/^\{|\}$/g, '').replace(/^\(|\)$/g, '');
  return cleaned.split(/\s+OR\s+|\s+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
}

function buildFromCriteria(senders) {
  if (senders.length === 1) return senders[0];
  return `{${senders.join(' ')}}`;
}

// ---- Filter group storage ----

async function getFilterGroups() {
  const email = await getAuthenticatedEmail();
  const key = `filterGroups_${email}`;
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (data) => {
      resolve(data[key] || []);
    });
  });
}

async function saveFilterGroups(groups) {
  const email = await getAuthenticatedEmail();
  const key = `filterGroups_${email}`;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: groups }, resolve);
  });
}

// Migrate old un-namespaced filterGroups to the authenticated account
async function migrateFilterGroups() {
  const email = await getAuthenticatedEmail();
  const key = `filterGroups_${email}`;
  return new Promise((resolve) => {
    chrome.storage.local.get(['filterGroups', key], (data) => {
      if (data.filterGroups && data.filterGroups.length > 0 && (!data[key] || data[key].length === 0)) {
        chrome.storage.local.set({ [key]: data.filterGroups }, () => {
          chrome.storage.local.remove('filterGroups', resolve);
        });
      } else {
        resolve();
      }
    });
  });
}

async function saveFilterGroup(action, oldFilterId, newFilterId, senders) {
  const groups = await getFilterGroups();
  const actionKey = JSON.stringify(action);

  const idx = groups.findIndex(g => g.actionKey === actionKey);
  if (idx >= 0) {
    groups[idx].filterIds = groups[idx].filterIds.filter(id => id !== oldFilterId);
    if (!groups[idx].filterIds.includes(newFilterId)) {
      groups[idx].filterIds.push(newFilterId);
    }
    groups[idx].senders = [...new Set(senders)];
  } else {
    groups.push({
      actionKey,
      action,
      filterIds: [newFilterId],
      senders: [...new Set(senders)],
      createdAt: Date.now()
    });
  }
  await saveFilterGroups(groups);
}

async function addToFilterGroup(action, filterId, senders) {
  const groups = await getFilterGroups();
  const actionKey = JSON.stringify(action);

  const idx = groups.findIndex(g => g.actionKey === actionKey);
  if (idx >= 0) {
    if (!groups[idx].filterIds.includes(filterId)) {
      groups[idx].filterIds.push(filterId);
    }
    groups[idx].senders = [...new Set([...groups[idx].senders, ...senders])];
  } else {
    groups.push({
      actionKey,
      action,
      filterIds: [filterId],
      senders: [...new Set(senders)],
      createdAt: Date.now()
    });
  }
  await saveFilterGroups(groups);
}

async function removeFromFilterGroup(actionKey, senderToRemove) {
  const groups = await getFilterGroups();
  const idx = groups.findIndex(g => g.actionKey === actionKey);
  if (idx < 0) return;

  groups[idx].senders = groups[idx].senders.filter(s => s !== senderToRemove);
  const action = groups[idx].action;
  const remainingSenders = groups[idx].senders;

  for (const fid of groups[idx].filterIds) {
    try { await deleteFilter(fid); } catch (e) { /* may already be gone */ }
  }

  if (remainingSenders.length === 0) {
    groups.splice(idx, 1);
  } else {
    const criteria = buildFromCriteria(remainingSenders);
    const result = await createFilter({ from: criteria }, action);
    groups[idx].filterIds = [result.id];
  }

  await saveFilterGroups(groups);
}

async function deleteFilterGroup(actionKey) {
  const groups = await getFilterGroups();
  const idx = groups.findIndex(g => g.actionKey === actionKey);
  if (idx < 0) return;

  for (const fid of groups[idx].filterIds) {
    try { await deleteFilter(fid); } catch (e) { /* may already be gone */ }
  }

  groups.splice(idx, 1);
  await saveFilterGroups(groups);
}

// ---- Message handler ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => {
    console.error('[GFM Background] Error:', err);
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(msg) {
  console.log('[GFM Background] Received:', msg.type);

  switch (msg.type) {
    case 'GET_AUTH_TOKEN': {
      // If no accounts exist, prompt to add one + migrate
      const accounts = await getAccounts();
      if (accounts.length === 0) {
        await addAccount();
        await migrateFilterGroups();
      } else {
        // Verify active token is valid
        await getValidTokenForActiveAccount();
      }
      return { success: true };
    }

    case 'GET_ACCOUNT_EMAIL':
      return { email: await getAuthenticatedEmail() };

    case 'ADD_ACCOUNT': {
      const email = await addAccount();
      return { success: true, email };
    }

    case 'REMOVE_ACCOUNT':
      await removeAccount(msg.email);
      return { success: true };

    case 'SWITCH_ACCOUNT':
      await setActiveAccountEmail(msg.email);
      // Broadcast to Gmail tabs
      chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'ACTIVE_ACCOUNT_CHANGED', email: msg.email });
        }
      });
      return { success: true };

    case 'VALIDATE_ACCOUNT': {
      // Verify a specific account's token is still valid with Google
      const allAccts = await getAccounts();
      const acct = allAccts.find(a => a.email === msg.email);
      if (!acct) return { valid: false, reason: 'not_found' };

      // Try refreshing the token to confirm Google hasn't revoked access
      try {
        if (acct.expiresAt && Date.now() < acct.expiresAt - 60000) {
          // Token not expired yet — do a lightweight check with userinfo
          const checkRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${acct.accessToken}` }
          });
          if (checkRes.ok) return { valid: true };
        }
        // Token expired or check failed — try refresh
        if (!acct.refreshToken) {
          await removeAccount(msg.email);
          return { valid: false, reason: 'revoked' };
        }
        const tokenData = await refreshAccessToken(acct.refreshToken);
        if (!tokenData || !tokenData.access_token) {
          await removeAccount(msg.email);
          return { valid: false, reason: 'revoked' };
        }
        // Update the stored token
        acct.accessToken = tokenData.access_token;
        acct.expiresAt = Date.now() + (tokenData.expires_in * 1000);
        if (tokenData.refresh_token) acct.refreshToken = tokenData.refresh_token;
        await saveAccounts(allAccts);
        return { valid: true };
      } catch (e) {
        await removeAccount(msg.email);
        return { valid: false, reason: 'revoked' };
      }
    }

    case 'GET_ACCOUNTS': {
      const allAccounts = await getAccounts();
      const activeEmail = await getActiveAccountEmail();
      return {
        accounts: allAccounts.map(a => ({ email: a.email })),
        activeEmail
      };
    }

    case 'ACTION_BY_SENDERS':
      return await actionBySenders(msg.senders, msg.actionType);

    case 'ACTION_BY_THREADS':
      return await actionByThreads(msg.threadIds, msg.actionType);

    case 'LABEL_BY_SENDERS':
      return await labelBySenders(msg.senders, msg.labelId);

    case 'LABEL_BY_THREADS':
      return await labelByThreads(msg.threadIds, msg.labelId);

    case 'GET_LABELS':
      return { labels: await getLabels() };

    case 'CREATE_LABEL': {
      const label = await createLabel(msg.name);
      return { label };
    }

    case 'CREATE_FILTER':
      return await smartCreateFilter(msg.senders, msg.filterAction);

    case 'APPLY_FILTER_TO_EXISTING':
      return await applyFilterToExisting(msg.senders, msg.filterAction);

    case 'GET_FILTER_GROUPS':
      return { groups: await getFilterGroups() };

    case 'REMOVE_SENDER_FROM_GROUP':
      await removeFromFilterGroup(msg.actionKey, msg.sender);
      return { success: true };

    case 'DELETE_FILTER_GROUP':
      await deleteFilterGroup(msg.actionKey);
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
