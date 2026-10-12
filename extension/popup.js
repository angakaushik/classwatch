// popup.js - Controller for ClassWatch Student Extension Popup

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const classCodeInput = document.getElementById('classCode');
  const studentNameInput = document.getElementById('studentName');
  const joinBtn = document.getElementById('joinBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const openDashboardBtn = document.getElementById('openDashboardBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const sessionInfo = document.getElementById('sessionInfo');
  const currentActiveDomain = document.getElementById('currentActiveDomain');
  const currentTabCount = document.getElementById('currentTabCount');

  // Load existing configuration and state from storage
  const stored = await chrome.storage.local.get([
    'serverUrl',
    'classCode',
    'studentName',
    'isJoined',
    'connectionStatus',
    'activeDomain',
    'tabCount',
    'isLocked'
  ]);

  serverUrlInput.value = stored.serverUrl || 'ws://localhost:3000';
  classCodeInput.value = stored.classCode || '';
  studentNameInput.value = stored.studentName || '';

  updateUI(stored);

  // Open Dashboard Button handler
  openDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });

  // Join button handler
  joinBtn.addEventListener('click', async () => {
    const rawUrl = serverUrlInput.value.trim();
    const classCode = classCodeInput.value.trim();
    const studentName = studentNameInput.value.trim();

    if (!rawUrl) {
      alert('Please enter the server WebSocket URL (e.g. ws://192.168.1.15:3000)');
      return;
    }

    if (!classCode || classCode.length !== 4) {
      alert('Please enter a valid 4-digit class code.');
      return;
    }

    if (!studentName) {
      alert('Please enter your name.');
      return;
    }

    // Format URL (ensure ws:// or wss://)
    let serverUrl = rawUrl;
    if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
      serverUrl = 'ws://' + serverUrl;
    }

    // Save configuration
    await chrome.storage.local.set({
      serverUrl,
      classCode,
      studentName,
      isJoined: true,
      connectionStatus: 'connecting',
      autoOpenDashboard: true
    });

    updateUI({
      isJoined: true,
      connectionStatus: 'connecting',
      isLocked: false
    });

    // Notify background service worker to initiate connection
    chrome.runtime.sendMessage({
      type: 'CMD_JOIN',
      serverUrl,
      classCode,
      studentName
    });
  });

  // Leave button handler
  leaveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      isJoined: false,
      connectionStatus: 'disconnected',
      isLocked: false
    });

    updateUI({
      isJoined: false,
      connectionStatus: 'disconnected',
      isLocked: false
    });

    // Notify background service worker to leave session and notify teacher
    chrome.runtime.sendMessage({
      type: 'CMD_LEAVE'
    });
  });

  // Listen for state changes from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATUS_UPDATE') {
      updateUI(message);
    }
  });

  function updateUI(state) {
    const isJoined = !!state.isJoined;
    const connStatus = state.connectionStatus || 'disconnected';
    const isLocked = !!state.isLocked;

    // Reset status badge classes
    statusBadge.className = 'status-badge';

    if (isLocked) {
      statusBadge.classList.add('locked');
      statusText.innerText = '🔒 Screen Locked by Teacher';
    } else if (connStatus === 'connected') {
      statusBadge.classList.add('connected');
      statusText.innerText = 'Connected to Class';
    } else if (connStatus === 'connecting') {
      statusBadge.classList.add('connecting');
      statusText.innerText = 'Connecting...';
    } else if (connStatus === 'error') {
      statusBadge.classList.add('error');
      statusText.innerText = state.errorMessage || 'Invalid Code / Error';
    } else {
      statusText.innerText = 'Disconnected';
    }

    // Inputs and buttons state
    if (isJoined && (connStatus === 'connected' || connStatus === 'connecting')) {
      serverUrlInput.disabled = true;
      classCodeInput.disabled = true;
      studentNameInput.disabled = true;
      joinBtn.disabled = true;
      leaveBtn.disabled = false;
      sessionInfo.style.display = 'block';
    } else {
      serverUrlInput.disabled = false;
      classCodeInput.disabled = false;
      studentNameInput.disabled = false;
      joinBtn.disabled = false;
      leaveBtn.disabled = true;
      sessionInfo.style.display = 'none';
    }

    if (state.activeDomain !== undefined) {
      currentActiveDomain.innerText = state.activeDomain || 'None';
    }
    if (state.tabCount !== undefined) {
      currentTabCount.innerText = state.tabCount;
    }
  }
});
