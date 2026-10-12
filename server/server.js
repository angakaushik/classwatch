const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

// Helper to find LAN IP address
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const DEFAULT_STUDY_FOLDERS = [
  {
    id: 'maths',
    name: 'Maths',
    color: 'blue',
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
    links: [
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' },
      { title: 'Google Docs', domain: 'docs.google.com', url: 'https://docs.google.com' }
    ]
  },
  {
    id: 'social',
    name: 'Social Studies',
    color: 'purple',
    links: [
      { title: 'NCERT', domain: 'ncert.nic.in', url: 'https://ncert.nic.in' },
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' }
    ]
  },
  {
    id: 'library',
    name: 'Library',
    color: 'teal',
    links: [
      { title: 'Wikipedia', domain: 'wikipedia.org', url: 'https://www.wikipedia.org' },
      { title: 'Khan Academy', domain: 'khanacademy.org', url: 'https://www.khanacademy.org' }
    ]
  }
];

const DEFAULT_SOCIAL_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'snapchat.com',
  'tiktok.com',
  'whatsapp.com',
  'web.whatsapp.com',
  'reddit.com',
  'discord.com',
  'netflix.com',
  'primevideo.com',
  'hotstar.com',
  'telegram.org',
  'web.telegram.org',
  'pinterest.com'
];

function createClassWatchServer(options = {}) {
  const port = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
  const classCode = options.classCode || String(Math.floor(1000 + Math.random() * 9000));
  const teacherKey = options.teacherKey || crypto.randomBytes(16).toString('hex');
  const lanIp = options.lanIp || getLanIp();

  let allowedDomains = options.allowedDomains || [
    'wikipedia.org',
    'khanacademy.org',
    'ncert.nic.in',
    'docs.google.com'
  ];

  let studyFolders = options.studyFolders ? JSON.parse(JSON.stringify(options.studyFolders)) : JSON.parse(JSON.stringify(DEFAULT_STUDY_FOLDERS));
  let socialDomains = options.socialDomains ? [...options.socialDomains] : [...DEFAULT_SOCIAL_DOMAINS];

  // In-memory data structures
  const students = new Map(); // studentId -> student data
  const teacherSockets = new Set();
  const alerts = [];
  const alertCooldowns = new Map(); // `${studentId}:${domain}` -> timestamp
  const COOLDOWN_MS = 60000;

  function isDomainAllowed(domain) {
    if (!domain) return true;
    const d = domain.trim().toLowerCase();

    // Never flag localhost, 127.0.0.1, or server's own LAN IP
    if (d === 'localhost' || d === '127.0.0.1' || d === lanIp || d === '::1' || d.startsWith('127.')) {
      return true;
    }

    // Never flag internal browser or extension pages
    if (d === 'newtab' || d === 'extensions' || d === 'lock.html' || d === 'dashboard.html' || d.startsWith('chrome') || d === 'about:blank') {
      return true;
    }

    // 1. Check direct allowedDomains list (subdomains allowed)
    const inAllowed = allowedDomains.some(allowed => {
      const a = allowed.trim().toLowerCase();
      if (!a) return false;
      return d === a || d.endsWith('.' + a);
    });
    if (inAllowed) return true;

    // 2. Check study folders (every domain in a folder is automatically treated as allowed)
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

  function isSocialDomain(domain) {
    if (!domain) return false;
    const d = domain.trim().toLowerCase();
    return socialDomains.some(s => {
      const item = s.trim().toLowerCase();
      if (!item) return false;
      return d === item || d.endsWith('.' + item);
    });
  }

  function shouldCreateAlert(studentId, domain) {
    const key = `${studentId}:${domain.toLowerCase()}`;
    const now = Date.now();
    const lastTime = alertCooldowns.get(key) || 0;
    if (now - lastTime >= COOLDOWN_MS) {
      alertCooldowns.set(key, now);
      return true;
    }
    return false;
  }

  function getCleanStudentsList() {
    const list = [];
    const now = Date.now();
    for (const s of students.values()) {
      const isOnline = !!s.ws && (now - s.lastSeen <= 60000);
      const isDisallowed = s.activeDomain ? !isDomainAllowed(s.activeDomain) : false;
      const isSocial = isDisallowed && isSocialDomain(s.activeDomain);
      const severity = !isDisallowed ? 'normal' : (isSocial ? 'high' : 'medium');

      list.push({
        id: s.id,
        name: s.name,
        activeDomain: s.activeDomain || '',
        tabs: s.tabs || [],
        tabCount: s.tabCount || 0,
        isLocked: !!s.isLocked,
        isDisallowed: isDisallowed,
        isSocial: isSocial,
        severity: severity,
        isOnline: isOnline,
        lastSeen: s.lastSeen
      });
    }
    return list;
  }

  function broadcastToTeachers(message) {
    const payload = JSON.stringify(message);
    for (const ws of teacherSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  function broadcastStudentState() {
    broadcastToTeachers({
      type: 'STUDENTS_UPDATE',
      students: getCleanStudentsList()
    });
  }

  function broadcastAlerts() {
    broadcastToTeachers({
      type: 'ALERTS_UPDATE',
      alerts: alerts
    });
  }

  function reevaluateAllStudents() {
    for (const s of students.values()) {
      if (s.activeDomain) {
        s.isDisallowed = !isDomainAllowed(s.activeDomain);
        s.isSocial = s.isDisallowed && isSocialDomain(s.activeDomain);
        s.severity = !s.isDisallowed ? 'normal' : (s.isSocial ? 'high' : 'medium');
      }
    }
    broadcastStudentState();
  }

  // Periodic offline check (every 5 seconds)
  const offlineCheckInterval = setInterval(() => {
    let stateChanged = false;
    const now = Date.now();
    for (const s of students.values()) {
      const isOnline = !!s.ws && (now - s.lastSeen <= 60000);
      if (s.isOnline !== isOnline) {
        s.isOnline = isOnline;
        stateChanged = true;
      }
    }
    if (stateChanged && teacherSockets.size > 0) {
      broadcastStudentState();
    }
  }, 5000);

  // HTTP Server
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const key = parsedUrl.searchParams.get('key');

    // Root dashboard route requires valid teacher key
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      if (key !== teacherKey) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>403 Forbidden</h1><p>Access denied. Valid teacher secret key is required.</p></body></html>');
        return;
      }

      const indexPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error loading dashboard');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // Config API endpoint
    if (parsedUrl.pathname === '/api/config') {
      if (key !== teacherKey) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        classCode,
        teacherKey,
        lanIp,
        port,
        serverAddress: `ws://${lanIp}:${port}`,
        allowedDomains,
        studyFolders,
        socialDomains
      }));
      return;
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // WebSocket Server
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/teacher') {
      const key = parsedUrl.searchParams.get('key');
      if (key !== teacherKey) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, 'teacher');
      });
    } else if (pathname === '/student') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, 'student');
      });
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request, role) => {
    if (role === 'teacher') {
      teacherSockets.add(ws);

      // Send initial full state to teacher
      ws.send(JSON.stringify({
        type: 'INIT',
        classCode,
        teacherKey,
        lanIp,
        port,
        serverAddress: `ws://${lanIp}:${port}`,
        allowedDomains,
        studyFolders,
        socialDomains,
        students: getCleanStudentsList(),
        alerts
      }));

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === 'UPDATE_ALLOWED_DOMAINS') {
            if (Array.isArray(msg.domains)) {
              allowedDomains = msg.domains.map(d => d.trim().toLowerCase()).filter(Boolean);
              // Push to all students immediately
              for (const s of students.values()) {
                if (s.ws && s.ws.readyState === WebSocket.OPEN) {
                  s.ws.send(JSON.stringify({
                    type: 'ALLOWED_DOMAINS_UPDATE',
                    allowedDomains
                  }));
                }
              }
              // Broadcast to all teachers
              broadcastToTeachers({
                type: 'ALLOWED_DOMAINS_UPDATE',
                allowedDomains
              });
              reevaluateAllStudents();
            }
          } else if (msg.type === 'UPDATE_STUDY_FOLDERS') {
            if (Array.isArray(msg.folders)) {
              studyFolders = msg.folders;
              // Push to students immediately
              for (const s of students.values()) {
                if (s.ws && s.ws.readyState === WebSocket.OPEN) {
                  s.ws.send(JSON.stringify({
                    type: 'STUDY_FOLDERS_UPDATE',
                    studyFolders
                  }));
                }
              }
              // Broadcast to teachers
              broadcastToTeachers({
                type: 'STUDY_FOLDERS_UPDATE',
                studyFolders
              });
              reevaluateAllStudents();
            }
          } else if (msg.type === 'UPDATE_SOCIAL_DOMAINS') {
            if (Array.isArray(msg.domains)) {
              socialDomains = msg.domains.map(d => d.trim().toLowerCase()).filter(Boolean);
              broadcastToTeachers({
                type: 'SOCIAL_DOMAINS_UPDATE',
                socialDomains
              });
              reevaluateAllStudents();
            }
          } else if (msg.type === 'SEND_WARNING') {
            const student = students.get(msg.studentId);
            if (student && student.ws && student.ws.readyState === WebSocket.OPEN) {
              student.ws.send(JSON.stringify({
                type: 'WARNING',
                message: msg.message || 'Warning from teacher: Please stay on task.'
              }));
            }
          } else if (msg.type === 'LOCK_STUDENT') {
            const student = students.get(msg.studentId);
            if (student) {
              student.isLocked = !!msg.locked;
              if (student.ws && student.ws.readyState === WebSocket.OPEN) {
                student.ws.send(JSON.stringify({
                  type: 'LOCK',
                  locked: !!msg.locked,
                  reason: msg.reason || 'Screen locked by teacher'
                }));
              }
              broadcastStudentState();
            }
          } else if (msg.type === 'UNLOCK_STUDENT') {
            const student = students.get(msg.studentId);
            if (student) {
              student.isLocked = false;
              if (student.ws && student.ws.readyState === WebSocket.OPEN) {
                student.ws.send(JSON.stringify({
                  type: 'LOCK',
                  locked: false
                }));
              }
              broadcastStudentState();
            }
          } else if (msg.type === 'UNLOCK_ALL') {
            for (const student of students.values()) {
              student.isLocked = false;
              if (student.ws && student.ws.readyState === WebSocket.OPEN) {
                student.ws.send(JSON.stringify({
                  type: 'LOCK',
                  locked: false
                }));
              }
            }
            broadcastStudentState();
          } else if (msg.type === 'DISMISS_ALERT') {
            const idx = alerts.findIndex(a => a.id === msg.alertId);
            if (idx !== -1) {
              alerts.splice(idx, 1);
              broadcastAlerts();
            }
          } else if (msg.type === 'DISMISS_ALL_ALERTS') {
            alerts.length = 0;
            broadcastAlerts();
          }
        } catch (e) {
          console.error('Error processing teacher message:', e);
        }
      });

      ws.on('close', () => {
        teacherSockets.delete(ws);
      });

    } else if (role === 'student') {
      let currentStudentId = null;

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (msg.type === 'JOIN') {
            // Validate class code
            if (String(msg.classCode).trim() !== String(classCode)) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'INVALID_CODE',
                message: 'Invalid 4-digit class code.'
              }));
              ws.close(4001, 'Invalid class code');
              return;
            }

            const studentName = (msg.studentName || 'Student').trim().slice(0, 50);
            currentStudentId = msg.studentId || ('stu_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));

            let student = students.get(currentStudentId);
            if (!student) {
              student = {
                id: currentStudentId,
                name: studentName,
                activeDomain: '',
                tabs: [],
                tabCount: 0,
                isLocked: false,
                isDisallowed: false,
                isSocial: false,
                severity: 'normal',
                isOnline: true,
                lastSeen: Date.now(),
                ws: ws
              };
              students.set(currentStudentId, student);
            } else {
              student.name = studentName;
              student.isOnline = true;
              student.lastSeen = Date.now();
              student.ws = ws;
            }

            // Acknowledge join with studyFolders and socialDomains
            ws.send(JSON.stringify({
              type: 'JOINED',
              studentId: currentStudentId,
              classCode,
              allowedDomains,
              studyFolders,
              socialDomains,
              isLocked: student.isLocked
            }));

            // Notify teachers
            broadcastStudentState();

          } else if (msg.type === 'TAB_UPDATE') {
            if (!currentStudentId) return;
            const student = students.get(currentStudentId);
            if (!student) return;

            student.lastSeen = Date.now();
            student.isOnline = true;
            student.activeDomain = (msg.activeDomain || '').trim();
            student.tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
            student.tabCount = typeof msg.tabCount === 'number' ? msg.tabCount : student.tabs.length;

            const domain = student.activeDomain;
            const allowed = isDomainAllowed(domain);
            student.isDisallowed = !allowed;
            const isSocial = !allowed && isSocialDomain(domain);
            student.isSocial = isSocial;
            student.severity = !allowed ? (isSocial ? 'high' : 'medium') : 'normal';

            // Disallowed alert creation with 60s cooldown per student & domain
            // Rule: "Never flag localhost or the server's own IP."
            if (!allowed && domain) {
              if (shouldCreateAlert(currentStudentId, domain)) {
                const alertItem = {
                  id: 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                  type: 'DISALLOWED_DOMAIN',
                  severity: isSocial ? 'high' : 'medium',
                  category: isSocial ? 'social' : 'offtopic',
                  studentId: currentStudentId,
                  studentName: student.name,
                  domain: domain,
                  message: isSocial
                    ? `${student.name} opened social media: ${domain}`
                    : `${student.name} opened a site outside study material: ${domain}`,
                  timestamp: Date.now()
                };
                alerts.unshift(alertItem);
                if (alerts.length > 100) alerts.pop();
                broadcastAlerts();
              }
            }

            broadcastStudentState();

          } else if (msg.type === 'WARNING_ACK') {
            if (currentStudentId) {
              const student = students.get(currentStudentId);
              const name = student ? student.name : 'Student';
              const ackAlert = {
                id: 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                type: 'WARNING_ACK',
                severity: 'info',
                category: 'ack',
                studentId: currentStudentId,
                studentName: name,
                domain: '',
                message: `${name} acknowledged the warning`,
                timestamp: Date.now()
              };
              alerts.unshift(ackAlert);
              if (alerts.length > 100) alerts.pop();
              broadcastAlerts();
            }

          } else if (msg.type === 'PING') {
            if (currentStudentId) {
              const student = students.get(currentStudentId);
              if (student) {
                student.lastSeen = Date.now();
                student.isOnline = true;
              }
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG' }));
            }

          } else if (msg.type === 'LEAVE') {
            if (currentStudentId) {
              const student = students.get(currentStudentId);
              const name = student ? student.name : 'A student';

              // Alert teacher when student leaves
              const alertItem = {
                id: 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                type: 'STUDENT_LEFT',
                severity: 'medium',
                category: 'leave',
                studentId: currentStudentId,
                studentName: name,
                domain: '',
                timestamp: Date.now(),
                message: `${name} has left the session`
              };
              alerts.unshift(alertItem);
              if (alerts.length > 100) alerts.pop();
              broadcastAlerts();

              if (student) {
                student.isOnline = false;
                student.ws = null;
              }
              broadcastStudentState();
            }
            ws.close();
          }
        } catch (e) {
          console.error('Error handling student message:', e);
        }
      });

      ws.on('close', () => {
        if (currentStudentId) {
          const student = students.get(currentStudentId);
          if (student && student.ws === ws) {
            student.ws = null;
            student.isOnline = false;
            broadcastStudentState();
          }
        }
      });
    }
  });

  function start(callback) {
    server.listen(port, () => {
      console.log('==================================================');
      console.log('ClassWatch Teacher Server Started');
      console.log(`Class Code:  ${classCode}`);
      console.log(`Student WS:  ws://${lanIp}:${port}/student`);
      console.log(`ws://${lanIp}:${port}`);
      console.log(`Teacher URL: http://localhost:${port}/?key=${teacherKey}`);
      console.log('==================================================');
      if (callback) callback({ server, wss, port, classCode, teacherKey, lanIp });
    });
  }

  function close(callback) {
    clearInterval(offlineCheckInterval);
    for (const ws of teacherSockets) {
      try { ws.close(); } catch (e) {}
    }
    for (const s of students.values()) {
      if (s.ws) {
        try { s.ws.close(); } catch (e) {}
      }
    }
    wss.close(() => {
      server.close(callback);
    });
  }

  return {
    server,
    wss,
    port,
    classCode,
    teacherKey,
    lanIp,
    allowedDomains,
    studyFolders,
    socialDomains,
    students,
    alerts,
    start,
    close
  };
}

// If run directly via `node server.js`
if (require.main === module) {
  const instance = createClassWatchServer();
  instance.start();
}

module.exports = {
  createClassWatchServer,
  getLanIp,
  DEFAULT_STUDY_FOLDERS,
  DEFAULT_SOCIAL_DOMAINS
};
