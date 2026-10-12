// dashboard.js - Student Study Dashboard Controller

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(match) {
    switch (match) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return match;
    }
  });
}

const DEFAULT_FOLDERS = [
  {
    id: 'maths',
    name: 'Maths',
    color: 'blue',
    icon: '📐',
    links: [
      { title: 'Khan Academy', domain: 'khanacademy.org', url: 'https://www.khanacademy.org' },
      { title: 'NCERT Maths', domain: 'ncert.nic.in', url: 'https://ncert.nic.in' },
      { title: 'Desmos', domain: 'desmos.com', url: 'https://www.desmos.com/calculator' }
    ]
  },
  {
    id: 'science',
    name: 'Science',
    color: 'green',
    icon: '🔬',
    links: [
      { title: 'PhET Simulations', domain: 'phet.colorado.edu', url: 'https://phet.colorado.edu' },
      { title: 'NCERT Science', domain: 'ncert.nic.in', url: 'https://ncert.nic.in' },
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' }
    ]
  },
  {
    id: 'english',
    name: 'English',
    color: 'amber',
    icon: '📖',
    links: [
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' },
      { title: 'Google Docs', domain: 'docs.google.com', url: 'https://docs.google.com' }
    ]
  },
  {
    id: 'social',
    name: 'Social Studies',
    color: 'purple',
    icon: '🌍',
    links: [
      { title: 'NCERT', domain: 'ncert.nic.in', url: 'https://ncert.nic.in' },
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' }
    ]
  },
  {
    id: 'library',
    name: 'Library',
    color: 'teal',
    icon: '🏛️',
    links: [
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' },
      { title: 'Khan Academy', domain: 'khanacademy.org', url: 'https://www.khanacademy.org' }
    ]
  }
];

let studyFolders = [];
let currentFolder = null;
let notesSaveTimeout = null;

// Helper to get folder icon
function getFolderIcon(folderName) {
  const name = (folderName || '').toLowerCase();
  if (name.includes('math')) return '📐';
  if (name.includes('sci')) return '🔬';
  if (name.includes('eng')) return '📖';
  if (name.includes('social') || name.includes('hist') || name.includes('geo')) return '🌍';
  if (name.includes('lib')) return '🏛️';
  return '📁';
}

// Helper to get folder color
function getFolderColor(folder) {
  if (folder.color) return folder.color;
  const name = (folder.name || '').toLowerCase();
  if (name.includes('math')) return 'blue';
  if (name.includes('sci')) return 'green';
  if (name.includes('eng')) return 'amber';
  if (name.includes('social')) return 'purple';
  if (name.includes('lib')) return 'teal';
  return 'blue';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Theme Toggle setup
  const themeBtn = document.getElementById('themeToggleBtn');
  let currentTheme = localStorage.getItem('classwatch_student_theme') || 'dark';
  document.body.setAttribute('data-theme', currentTheme);

  themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', currentTheme);
    localStorage.setItem('classwatch_student_theme', currentTheme);
  });

  // Load state from storage
  await loadStateAndRender();

  // Listen for storage changes (live updates from teacher)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.studyFolders || changes.connectionStatus || changes.studentName || changes.classCode) {
      loadStateAndRender();
    }
  });

  // Top "New Tab" Search / URL bar handler
  const newTabForm = document.getElementById('newTabForm');
  const newTabInput = document.getElementById('newTabInput');

  newTabForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = newTabInput.value.trim();
    if (!query) return;

    let targetUrl = '';
    if (query.startsWith('http://') || query.startsWith('https://')) {
      targetUrl = query;
    } else if (query.includes('.') && !query.includes(' ')) {
      targetUrl = 'https://' + query;
    } else {
      targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }

    // Open in a new tab
    chrome.tabs.create({ url: targetUrl });
    newTabInput.value = '';
  });

  // Navigation handlers
  document.getElementById('breadcrumbHome').addEventListener('click', showAllFoldersView);
  document.getElementById('backBtn').addEventListener('click', showAllFoldersView);

  // Notes textarea auto-save
  const notesTextarea = document.getElementById('folderNotesTextarea');
  const notesSaveStatus = document.getElementById('notesSaveStatus');

  notesTextarea.addEventListener('input', () => {
    if (!currentFolder) return;
    notesSaveStatus.innerText = 'Saving...';
    notesSaveStatus.style.color = 'var(--warning)';

    if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
    notesSaveTimeout = setTimeout(async () => {
      const noteKey = `classwatch_notes_${currentFolder.id || currentFolder.name}`;
      await chrome.storage.local.set({ [noteKey]: notesTextarea.value });
      notesSaveStatus.innerText = 'Saved ✓';
      notesSaveStatus.style.color = 'var(--success)';
    }, 400);
  });
});

async function loadStateAndRender() {
  const data = await chrome.storage.local.get([
    'studentName',
    'classCode',
    'connectionStatus',
    'studyFolders',
    'isJoined'
  ]);

  // Header info
  const name = data.studentName || 'Student';
  document.getElementById('studentWelcomeText').innerText = `Welcome, ${name}`;
  document.getElementById('headerClassCode').innerText = data.classCode || '----';

  const dot = document.getElementById('headerStatusDot');
  const statusText = document.getElementById('headerStatusText');

  if (data.isJoined && data.connectionStatus === 'connected') {
    dot.className = 'status-dot';
    statusText.innerText = 'Connected to class';
  } else if (data.isJoined && data.connectionStatus === 'connecting') {
    dot.className = 'status-dot';
    dot.style.backgroundColor = 'var(--warning)';
    statusText.innerText = 'Connecting...';
  } else {
    dot.className = 'status-dot disconnected';
    statusText.innerText = 'Disconnected';
  }

  // Folders data
  if (data.studyFolders && Array.isArray(data.studyFolders) && data.studyFolders.length > 0) {
    studyFolders = data.studyFolders;
  } else {
    studyFolders = DEFAULT_FOLDERS;
  }

  // If currently inside a folder, refresh that folder's view; otherwise show grid
  if (currentFolder) {
    const fresh = studyFolders.find(f => (f.id && f.id === currentFolder.id) || f.name === currentFolder.name);
    if (fresh) {
      currentFolder = fresh;
      renderSingleFolder(fresh);
    } else {
      showAllFoldersView();
    }
  } else {
    renderFoldersGrid();
  }
}

function renderFoldersGrid() {
  const container = document.getElementById('foldersGrid');
  container.innerHTML = '';

  studyFolders.forEach((folder) => {
    const card = document.createElement('div');
    const colorClass = getFolderColor(folder);
    card.className = `folder-card ${colorClass}`;
    card.tabIndex = 0; // Accessible keyboard focus

    const icon = folder.icon || getFolderIcon(folder.name);
    const linkCount = (folder.links || []).length;

    let previewPills = '';
    (folder.links || []).slice(0, 3).forEach(link => {
      previewPills += `<span class="preview-pill">${escapeHtml(link.domain || link.title)}</span>`;
    });
    if (linkCount > 3) {
      previewPills += `<span class="preview-pill">+${linkCount - 3} more</span>`;
    }

    card.innerHTML = `
      <div class="folder-header">
        <span class="folder-icon-large">${icon}</span>
        <span class="folder-count-badge">${linkCount} ${linkCount === 1 ? 'Resource' : 'Resources'}</span>
      </div>
      <div>
        <h3 class="folder-title folder-tag">${escapeHtml(folder.name)}</h3>
      </div>
      <div class="folder-preview-links">
        ${previewPills}
      </div>
    `;

    // Click & Enter key to open
    const openHandler = () => {
      currentFolder = folder;
      renderSingleFolder(folder);
    };
    card.addEventListener('click', openHandler);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openHandler();
      }
    });

    container.appendChild(card);
  });
}

async function renderSingleFolder(folder) {
  document.getElementById('allFoldersView').style.display = 'none';
  document.getElementById('singleFolderView').style.display = 'block';
  document.getElementById('navBar').style.display = 'flex';

  document.getElementById('breadcrumbCurrent').innerText = folder.name;
  document.getElementById('folderViewHeading').innerText = `${folder.name} Study Resources`;
  document.getElementById('notesTitleSubject').innerText = `My Notes for ${folder.name}`;

  // Render link cards
  const linksContainer = document.getElementById('folderLinksList');
  linksContainer.innerHTML = '';

  if (!folder.links || folder.links.length === 0) {
    linksContainer.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-muted); background: var(--card-bg); border-radius: 12px; border: 1px solid var(--card-border);">
        No study links in this folder yet. Your teacher can add links from their dashboard.
      </div>
    `;
  } else {
    folder.links.forEach(link => {
      const card = document.createElement('div');
      card.className = 'study-link-card';

      let url = link.url;
      if (!url) {
        url = (link.domain && (link.domain.startsWith('http://') || link.domain.startsWith('https://')))
          ? link.domain
          : 'https://' + (link.domain || '');
      }

      card.innerHTML = `
        <div class="link-info">
          <div class="link-icon-box">🔗</div>
          <div>
            <div class="link-title">${escapeHtml(link.title || link.domain)}</div>
            <div class="link-domain">${escapeHtml(link.domain || '')}</div>
          </div>
        </div>
        <button class="open-link-btn" title="Open in new tab">
          <span>Open</span>
          <span>↗</span>
        </button>
      `;

      card.addEventListener('click', () => {
        chrome.tabs.create({ url: url });
      });

      linksContainer.appendChild(card);
    });
  }

  // Load folder notes from chrome.storage.local
  const noteKey = `classwatch_notes_${folder.id || folder.name}`;
  const stored = await chrome.storage.local.get(noteKey);
  const notesTextarea = document.getElementById('folderNotesTextarea');
  notesTextarea.value = stored[noteKey] || '';
  document.getElementById('notesSaveStatus').innerText = 'Saved ✓';
  document.getElementById('notesSaveStatus').style.color = 'var(--success)';
}

function showAllFoldersView() {
  currentFolder = null;
  document.getElementById('singleFolderView').style.display = 'none';
  document.getElementById('navBar').style.display = 'none';
  document.getElementById('allFoldersView').style.display = 'block';
  renderFoldersGrid();
}
