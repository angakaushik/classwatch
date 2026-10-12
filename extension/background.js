// background.js - Service Worker for ClassWatch Student Extension (Manifest V3)

let socket = null;
let reconnectTimer = null;
let debounceTimer = null;

// Helper to extract domain from URL
function extractDomain(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    if (u.protocol === 'chrome:' || u.protocol === 'chrome-extension:' || u.protocol === 'about:') {
      return u.hostname || u.protocol.replace(':', '');
    }
    return u.hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

// Safely send JSON message through WebSocket
function sendWsMessage(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

// Notify popup and storage of status updates
async function broadcastStatus(extra = {}) {
  const stored = await chrome.storage.local.get([
    'isJoined',
    'connectionStatus',
    'activeDomain',
    'tabCount',
    'isLocked',
    'errorMessage'
  ]);
  const payload = {
    type: 'STATUS_UPDATE',
    ...stored,
    ...extra
  };
  chrome.runtime.sendMessage(payload).catch(() => {
    // Popup might be closed, ignore
  });
}

// Check if domain is allowed based on storage cached whitelist and study folders
async function checkIsAllowed(domain) {
  if (!domain) return true;
  const d = domain.trim().toLowerCase();

  // Localhost, internal, extension pages
  if (d === 'localhost' || d === '127.0.0.1' || d === 'newtab' || d === 'extensions' || d === 'lock.html' || d === 'dashboard.html' || d.startsWith('chrome') || d === 'about:blank') {
    return true;
  }

  const { allowedDomains = [], studyFolders = [] } = await chrome.storage.local.get(['allowedDomains', 'studyFolders']);

  // Check allowed domains
  const inAllowed = allowedDomains.some(a => {
    const item = a.trim().toLowerCase();
    return item && (d === item || d.endsWith('.' + item));
  });
  if (inAllowed) return true;

  // Check study folders
  for (const folder of studyFolders) {
    if (Array.isArray(folder.links)) {
      for (const link of folder.links) {
        const ld = (link.domain || '').trim().toLowerCase();
        if (ld && (d === ld || d.endsWith('.' + ld))) {
          return true;
        }
      }
    }
  }

  return false;
}

// Collect open tabs domains and active tab domain (Privacy: never titles or full URLs)
async function collectAndSendTabState() {
  const { isJoined } = await chrome.storage.local.get('isJoined');
  if (!isJoined || !socket || socket.readyState !== WebSocket.OPEN) return;

  try {
    const allTabs = await chrome.tabs.query({});
    const domainSet = new Set();
    for (const tab of allTabs) {
      const d = extractDomain(tab.url);
      if (d) domainSet.add(d);
    }
    const openDomains = Array.from(domainSet);

    // Get active tab in last focused window
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let activeDomain = '';
    let targetTab = null;

    if (activeTab && activeTab.url) {
      activeDomain = extractDomain(activeTab.url);
      targetTab = activeTab;
    } else {
      const [fallbackTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (fallbackTab && fallbackTab.url) {
        activeDomain = extractDomain(fallbackTab.url);
        targetTab = fallbackTab;
      }
    }

    // Save to storage
    await chrome.storage.local.set({
      activeDomain,
      tabCount: allTabs.length
    });

    // Send only domains and tab count to teacher server
    sendWsMessage({
      type: 'TAB_UPDATE',
      activeDomain: activeDomain,
      tabs: openDomains,
      tabCount: allTabs.length
    });

    broadcastStatus({ activeDomain, tabCount: allTabs.length });

    // Handle in-tab amber banner for off-topic site
    if (targetTab && targetTab.id && targetTab.url && (targetTab.url.startsWith('http://') || targetTab.url.startsWith('https://'))) {
      const isAllowed = await checkIsAllowed(activeDomain);
      if (!isAllowed) {
        injectAmberOfftopicBanner(targetTab.id);
      } else {
        removeAmberOfftopicBanner(targetTab.id);
      }
    }
  } catch (err) {
    console.error('Error collecting tab state:', err);
  }
}

// Debounced tab state trigger
function scheduleTabUpdate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    collectAndSendTabState();
  }, 350);
}

// Inject teacher warning banner (Large Red Banner)
async function showTeacherWarningOnTab(teacherMessage) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.id || !activeTab.url) return;
    if (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://')) return;

    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: (msg) => {
        // Remove any existing warning banner
        const existing = document.getElementById('classwatch-teacher-warning-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'classwatch-teacher-warning-banner';
        banner.setAttribute('style', `
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100% !important;
          background: linear-gradient(135deg, #dc2626, #b91c1c) !important;
          color: #ffffff !important;
          padding: 16px 24px !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          box-shadow: 0 6px 25px rgba(0,0,0,0.5) !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 16px !important;
          font-weight: 600 !important;
          box-sizing: border-box !important;
          animation: slideDownCW 0.3s ease-out !important;
        `);

        const textSpan = document.createElement('div');
        textSpan.style.display = 'flex';
        textSpan.style.alignItems = 'center';
        textSpan.style.gap = '10px';
        textSpan.innerHTML = `<span>⚠️</span> <span>Message from your teacher: <strong>${msg}</strong></span>`;

        const gotItBtn = document.createElement('button');
        gotItBtn.innerText = 'Got it';
        gotItBtn.setAttribute('style', `
          background: #ffffff !important;
          color: #dc2626 !important;
          border: none !important;
          border-radius: 8px !important;
          padding: 8px 20px !important;
          font-weight: 800 !important;
          font-size: 14px !important;
          cursor: pointer !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2) !important;
        `);

        // Got it handler
        gotItBtn.addEventListener('click', () => {
          banner.remove();
          try {
            chrome.runtime.sendMessage({ type: 'STUDENT_WARNING_ACK_CLICKED' });
          } catch (e) {}
        });

        banner.appendChild(textSpan);
        banner.appendChild(gotItBtn);
        document.body.appendChild(banner);

        // Auto-remove after 30 seconds
        setTimeout(() => {
          if (banner.parentNode) banner.remove();
        }, 30000);
      },
      args: [teacherMessage]
    });
  } catch (err) {
    console.warn('Could not inject red teacher banner:', err);
  }
}

// Inject amber off-topic banner
async function injectAmberOfftopicBanner(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById('classwatch-offtopic-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'classwatch-offtopic-banner';
        banner.setAttribute('style', `
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100% !important;
          background: #d97706 !important;
          color: #ffffff !important;
          padding: 8px 16px !important;
          z-index: 2147483646 !important;
          text-align: center !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
          box-sizing: border-box !important;
        `);
        banner.innerText = '⚠️ This site is not on today\'s allowed list. Your teacher can see this.';
        document.body.appendChild(banner);
      }
    });
  } catch (err) {
    // Ignore pages where scripting is blocked
  }
}

// Remove amber off-topic banner
async function removeAmberOfftopicBanner(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const b = document.getElementById('classwatch-offtopic-banner');
        if (b) b.remove();
      }
    });
  } catch (err) {
    // Ignore
  }
}

// Open and enforce the lock screen
async function enforceLockScreen() {
  const lockUrl = chrome.runtime.getURL('lock.html');
  const tabs = await chrome.tabs.query({ url: lockUrl });

  let lockTab = tabs[0];
  if (!lockTab) {
    lockTab = await chrome.tabs.create({ url: 'lock.html', active: true });
  } else {
    await chrome.tabs.update(lockTab.id, { active: true });
  }

  await chrome.storage.local.set({
    isLocked: true,
    lockTabId: lockTab.id
  });
}

// Unlock and close the lock screen
async function releaseLockScreen() {
  await chrome.storage.local.set({ isLocked: false });
  const lockUrl = chrome.runtime.getURL('lock.html');
  const tabs = await chrome.tabs.query({ url: lockUrl });
  for (const t of tabs) {
    try {
      await chrome.tabs.remove(t.id);
    } catch (e) {}
  }
}

// Connect to student endpoint on teacher server
async function connectToServer() {
  const { serverUrl, classCode, studentName, studentId, isJoined, autoOpenDashboard } = await chrome.storage.local.get([
    'serverUrl',
    'classCode',
    'studentName',
    'studentId',
    'isJoined',
    'autoOpenDashboard'
  ]);

  if (!isJoined || !serverUrl) return;

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  let wsBase = serverUrl.trim();
  if (!wsBase.startsWith('ws://') && !wsBase.startsWith('wss://')) {
    wsBase = 'ws://' + wsBase;
  }
  wsBase = wsBase.replace(/\/+$/, '');
  const wsEndpoint = `${wsBase}/student`;

  try {
    socket = new WebSocket(wsEndpoint);

    socket.onopen = async () => {
      console.log('Connected to ClassWatch server');
      sendWsMessage({
        type: 'JOIN',
        classCode: classCode,
        studentName: studentName,
        studentId: studentId
      });
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'JOINED') {
          await chrome.storage.local.set({
            studentId: msg.studentId,
            connectionStatus: 'connected',
            isJoined: true,
            allowedDomains: msg.allowedDomains || [],
            studyFolders: msg.studyFolders || [],
            socialDomains: msg.socialDomains || []
          });

          broadcastStatus({ connectionStatus: 'connected' });

          // Auto-open study dashboard once on join
          const { autoOpenDashboard } = await chrome.storage.local.get('autoOpenDashboard');
          if (autoOpenDashboard) {
            chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
            await chrome.storage.local.set({ autoOpenDashboard: false });
          }

          // If locked
          if (msg.isLocked) {
            await enforceLockScreen();
          }

          // Initial tab state push
          collectAndSendTabState();

        } else if (msg.type === 'ERROR') {
          if (msg.code === 'INVALID_CODE') {
            await chrome.storage.local.set({
              connectionStatus: 'error',
              errorMessage: 'Invalid Class Code. Check with teacher.',
              isJoined: false
            });
            broadcastStatus({
              connectionStatus: 'error',
              errorMessage: 'Invalid Class Code. Check with teacher.',
              isJoined: false
            });
          }
        } else if (msg.type === 'ALLOWED_DOMAINS_UPDATE') {
          await chrome.storage.local.set({
            allowedDomains: msg.allowedDomains || []
          });
          scheduleTabUpdate();

        } else if (msg.type === 'STUDY_FOLDERS_UPDATE') {
          await chrome.storage.local.set({
            studyFolders: msg.studyFolders || []
          });
          scheduleTabUpdate();

        } else if (msg.type === 'WARNING') {
          const warningText = msg.message || 'Please return to approved class materials.';

          // 1. In-tab large red banner
          showTeacherWarningOnTab(warningText);

          // 2. Chrome notification as backup
          chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon128.png'),
            title: 'ClassWatch Teacher Alert',
            message: warningText
          });

        } else if (msg.type === 'LOCK') {
          if (msg.locked) {
            await enforceLockScreen();
          } else {
            await releaseLockScreen();
          }
          broadcastStatus({ isLocked: !!msg.locked });

        } else if (msg.type === 'PONG') {
          // Heartbeat ack
        }
      } catch (err) {
        console.error('Error parsing server message:', err);
      }
    };

    socket.onclose = async (event) => {
      console.log('Socket closed:', event.code, event.reason);
      socket = null;
      const { isJoined } = await chrome.storage.local.get('isJoined');
      if (isJoined) {
        await chrome.storage.local.set({ connectionStatus: 'connecting' });
        broadcastStatus({ connectionStatus: 'connecting' });
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectToServer, 3500);
      }
    };

    socket.onerror = (err) => {
      console.error('Socket error:', err);
    };

  } catch (err) {
    console.error('Failed to create WebSocket:', err);
  }
}

// 30-second ping function
function sendPing() {
  sendWsMessage({ type: 'PING' });
}

// Setup chrome alarms for keep-alive & pinging
chrome.alarms.create('classwatch_ping_alarm', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'classwatch_ping_alarm') {
    sendPing();
    chrome.storage.local.get('isJoined').then(({ isJoined }) => {
      if (isJoined && (!socket || socket.readyState !== WebSocket.OPEN)) {
        connectToServer();
      }
    });
  }
});

// Tab & Window Event Listeners
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { isLocked, lockTabId } = await chrome.storage.local.get(['isLocked', 'lockTabId']);
  if (isLocked) {
    if (lockTabId && activeInfo.tabId !== lockTabId) {
      try {
        await chrome.tabs.update(lockTabId, { active: true });
      } catch (e) {
        await enforceLockScreen();
      }
      return;
    }
  }
  scheduleTabUpdate();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    scheduleTabUpdate();
  }
});

chrome.tabs.onCreated.addListener(() => {
  scheduleTabUpdate();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { isLocked, lockTabId } = await chrome.storage.local.get(['isLocked', 'lockTabId']);
  if (isLocked && tabId === lockTabId) {
    await enforceLockScreen();
  }
  scheduleTabUpdate();
});

chrome.windows.onFocusChanged.addListener(() => {
  scheduleTabUpdate();
});

// Runtime messages from popup or in-tab script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CMD_JOIN') {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    connectToServer();
    sendResponse({ ok: true });

  } else if (message.type === 'CMD_LEAVE') {
    sendWsMessage({
      type: 'LEAVE',
      reason: 'Student initiated leave'
    });
    if (socket) {
      try { socket.close(); } catch (e) {}
      socket = null;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    releaseLockScreen();
    chrome.storage.local.set({
      isJoined: false,
      connectionStatus: 'disconnected',
      isLocked: false
    });
    broadcastStatus({
      isJoined: false,
      connectionStatus: 'disconnected',
      isLocked: false
    });
    sendResponse({ ok: true });

  } else if (message.type === 'STUDENT_WARNING_ACK_CLICKED') {
    // Send acknowledgement to teacher server
    sendWsMessage({
      type: 'WARNING_ACK'
    });
    sendResponse({ ok: true });
  }
  return true;
});

// Resume connection on worker restart if session was active
chrome.storage.local.get('isJoined').then(({ isJoined }) => {
  if (isJoined) {
    connectToServer();
  }
});
