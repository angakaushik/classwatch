// test.js - Comprehensive integration tests for ClassWatch with upgrade features
const http = require('http');
const { WebSocket } = require('ws');
const { createClassWatchServer } = require('./server');

function requestHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

function waitEvent(ws, eventType, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WS message type: ${eventType}`));
    }, timeout);

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === eventType) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    };

    ws.on('message', handler);
  });
}

async function runTests() {
  console.log('--- Starting ClassWatch Upgraded Integration Tests ---\n');

  const testPort = 3998;
  const instance = createClassWatchServer({ port: testPort });

  await new Promise((resolve) => instance.start(resolve));
  console.log(`[PASS] Server started on port ${testPort}`);

  const teacherKey = instance.teacherKey;
  const classCode = instance.classCode;

  try {
    // Test 1: "/" without the key returns 403
    console.log('\nTest 1: HTTP GET "/" without key');
    const resNoKey = await requestHttp(`http://localhost:${testPort}/`);
    if (resNoKey.statusCode === 403) {
      console.log('  [PASS] Status code is 403 Forbidden without key');
    } else {
      throw new Error(`Expected 403, got ${resNoKey.statusCode}`);
    }

    // Test 2: "/" with invalid key returns 403
    console.log('\nTest 2: HTTP GET "/" with invalid key');
    const resBadKey = await requestHttp(`http://localhost:${testPort}/?key=invalid_secret_key`);
    if (resBadKey.statusCode === 403) {
      console.log('  [PASS] Status code is 403 Forbidden with invalid key');
    } else {
      throw new Error(`Expected 403, got ${resBadKey.statusCode}`);
    }

    // Test 3: "/" with valid key returns 200
    console.log('\nTest 3: HTTP GET "/" with valid key');
    const resGoodKey = await requestHttp(`http://localhost:${testPort}/?key=${teacherKey}`);
    if (resGoodKey.statusCode === 200 && resGoodKey.body.includes('ClassWatch')) {
      console.log('  [PASS] Status code is 200 and dashboard HTML is served');
    } else {
      throw new Error(`Expected 200 with dashboard HTML, got ${resGoodKey.statusCode}`);
    }

    // Test 4: Teacher WebSocket connection receives INIT with study folders and social domains
    console.log('\nTest 4: Teacher WebSocket connection & INIT payload');
    const teacherWs = new WebSocket(`ws://localhost:${testPort}/teacher?key=${teacherKey}`);
    const teacherInit = await waitEvent(teacherWs, 'INIT');
    if (teacherInit.classCode === classCode && Array.isArray(teacherInit.studyFolders) && Array.isArray(teacherInit.socialDomains)) {
      console.log(`  [PASS] Teacher WS received INIT with classCode: ${classCode}, ${teacherInit.studyFolders.length} folders, ${teacherInit.socialDomains.length} social domains`);
    } else {
      throw new Error(`INIT payload invalid: ${JSON.stringify(teacherInit)}`);
    }

    // Test 5: Student joins with wrong class code -> rejected
    console.log('\nTest 5: Student joins with wrong class code');
    const badStudentWs = new WebSocket(`ws://localhost:${testPort}/student`);
    await new Promise((resolve) => badStudentWs.on('open', resolve));

    badStudentWs.send(JSON.stringify({
      type: 'JOIN',
      classCode: '0000', // wrong code
      studentName: 'Hacker'
    }));

    const errorMsg = await waitEvent(badStudentWs, 'ERROR');
    if (errorMsg.code === 'INVALID_CODE') {
      console.log('  [PASS] Server rejected wrong class code with INVALID_CODE');
    } else {
      throw new Error(`Expected INVALID_CODE, got ${JSON.stringify(errorMsg)}`);
    }

    // Test 6: Student joins with correct class code -> joins successfully with studyFolders
    console.log('\nTest 6: Student joins with valid class code & receives studyFolders');
    const studentWs = new WebSocket(`ws://localhost:${testPort}/student`);
    await new Promise((resolve) => studentWs.on('open', resolve));

    studentWs.send(JSON.stringify({
      type: 'JOIN',
      classCode: classCode,
      studentName: 'Alice Johnson'
    }));

    const joinedMsg = await waitEvent(studentWs, 'JOINED');
    const studentId = joinedMsg.studentId;
    if (joinedMsg.studyFolders && joinedMsg.studyFolders.length >= 5) {
      console.log(`  [PASS] Student joined successfully with studentId: ${studentId} and received ${joinedMsg.studyFolders.length} study folders`);
    } else {
      throw new Error('Study folders missing from JOINED message');
    }

    // Wait for teacher to receive STUDENTS_UPDATE
    const teacherUpdate = await waitEvent(teacherWs, 'STUDENTS_UPDATE');
    const aliceInTeacher = teacherUpdate.students.find(s => s.id === studentId);
    if (aliceInTeacher && aliceInTeacher.name === 'Alice Johnson') {
      console.log('  [PASS] Teacher dashboard received student list with Alice Johnson');
    } else {
      throw new Error('Student not found in teacher update');
    }

    // Test 7: Subdomain on allowed list (wikipedia.org)
    console.log('\nTest 7: Student visits allowed domain (en.wikipedia.org)');
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'en.wikipedia.org',
      tabs: ['en.wikipedia.org', 'ncert.nic.in'],
      tabCount: 2
    }));

    const studentUpdateAllowed = await waitEvent(teacherWs, 'STUDENTS_UPDATE');
    const sAllowed = studentUpdateAllowed.students.find(s => s.id === studentId);
    if (!sAllowed.isDisallowed) {
      console.log('  [PASS] en.wikipedia.org correctly allowed (isDisallowed=false)');
    } else {
      throw new Error('Allowed domain en.wikipedia.org was marked disallowed');
    }

    // Test 8: Folder domain automatically treated as allowed (desmos.com in Maths folder)
    console.log('\nTest 8: Student visits domain from study folders (desmos.com)');
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'desmos.com',
      tabs: ['desmos.com'],
      tabCount: 1
    }));

    const studentUpdateFolder = await waitEvent(teacherWs, 'STUDENTS_UPDATE');
    const sFolder = studentUpdateFolder.students.find(s => s.id === studentId);
    if (!sFolder.isDisallowed) {
      console.log('  [PASS] Folder domain desmos.com is automatically treated as allowed');
    } else {
      throw new Error('Folder domain desmos.com was not treated as allowed');
    }

    // Test 9: Never flag localhost or server IP
    console.log('\nTest 9: Student active on localhost / internal IP');
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'localhost',
      tabs: ['localhost'],
      tabCount: 1
    }));
    const studentUpdateLocal = await waitEvent(teacherWs, 'STUDENTS_UPDATE');
    const sLocal = studentUpdateLocal.students.find(s => s.id === studentId);
    if (!sLocal.isDisallowed) {
      console.log('  [PASS] localhost is never flagged as disallowed');
    } else {
      throw new Error('localhost was flagged as disallowed');
    }

    // Test 10: Off-topic site creates MEDIUM alert (coolgames.com)
    console.log('\nTest 10: Student visits off-topic site (coolgames.com) -> MEDIUM severity alert');
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'coolgames.com',
      tabs: ['coolgames.com'],
      tabCount: 1
    }));

    const alertUpdateOfftopic = await waitEvent(teacherWs, 'ALERTS_UPDATE');
    const offtopicAlert = alertUpdateOfftopic.alerts.find(a => a.studentId === studentId && a.domain === 'coolgames.com');
    if (offtopicAlert && offtopicAlert.severity === 'medium' && offtopicAlert.category === 'offtopic') {
      console.log(`  [PASS] Off-topic alert created with severity: ${offtopicAlert.severity}, message: "${offtopicAlert.message}"`);
    } else {
      throw new Error(`Expected medium offtopic alert, got ${JSON.stringify(offtopicAlert)}`);
    }

    // Test 11: Social media site creates HIGH severity alert (instagram.com)
    console.log('\nTest 11: Student visits social media (instagram.com) -> HIGH severity alert');
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'instagram.com',
      tabs: ['instagram.com'],
      tabCount: 1
    }));

    const alertUpdateSocial = await waitEvent(teacherWs, 'ALERTS_UPDATE');
    const socialAlert = alertUpdateSocial.alerts.find(a => a.studentId === studentId && a.domain === 'instagram.com');
    if (socialAlert && socialAlert.severity === 'high' && socialAlert.category === 'social') {
      console.log(`  [PASS] High severity social alert created: "${socialAlert.message}"`);
    } else {
      throw new Error(`Expected high social alert, got ${JSON.stringify(socialAlert)}`);
    }

    // Test 12: Deduplication within 60 seconds
    console.log('\nTest 12: Alert deduplication within 60s');
    const countBefore = instance.alerts.length;
    studentWs.send(JSON.stringify({
      type: 'TAB_UPDATE',
      activeDomain: 'instagram.com',
      tabs: ['instagram.com'],
      tabCount: 1
    }));
    await new Promise(r => setTimeout(r, 200));
    if (instance.alerts.length === countBefore) {
      console.log('  [PASS] Duplicate alert suppressed by 60s cooldown');
    } else {
      throw new Error('Duplicate alert created within cooldown');
    }

    // Test 13: Teacher updates study folders -> student receives STUDY_FOLDERS_UPDATE
    console.log('\nTest 13: Teacher updates study folders & pushes to students');
    const updatedFolders = [
      ...instance.studyFolders,
      {
        id: 'coding',
        name: 'Coding',
        color: 'teal',
        links: [{ title: 'GitHub', domain: 'github.com', url: 'https://github.com' }]
      }
    ];

    teacherWs.send(JSON.stringify({
      type: 'UPDATE_STUDY_FOLDERS',
      folders: updatedFolders
    }));

    const studentFoldersMsg = await waitEvent(studentWs, 'STUDY_FOLDERS_UPDATE');
    if (studentFoldersMsg.studyFolders.some(f => f.name === 'Coding')) {
      console.log('  [PASS] Updated study folders pushed to student immediately');
    } else {
      throw new Error('Student did not receive updated study folders');
    }

    // Test 14: Teacher sends warning -> student receives warning
    console.log('\nTest 14: Teacher sends warning to student');
    teacherWs.send(JSON.stringify({
      type: 'SEND_WARNING',
      studentId: studentId,
      message: 'Please focus on your assignment'
    }));

    const warnMsg = await waitEvent(studentWs, 'WARNING');
    if (warnMsg.message === 'Please focus on your assignment') {
      console.log('  [PASS] Warning message delivered to student');
    } else {
      throw new Error(`Warning mismatch: got ${JSON.stringify(warnMsg)}`);
    }

    // Test 15: Student acknowledges warning -> teacher receives acknowledgement
    console.log('\nTest 15: Student acknowledges warning ("Got it")');
    studentWs.send(JSON.stringify({
      type: 'WARNING_ACK'
    }));

    const ackAlertUpdate = await waitEvent(teacherWs, 'ALERTS_UPDATE');
    const ackAlert = ackAlertUpdate.alerts.find(a => a.type === 'WARNING_ACK' && a.studentId === studentId);
    if (ackAlert && ackAlert.message.includes('acknowledged the warning')) {
      console.log(`  [PASS] Teacher alert feed received: "${ackAlert.message}"`);
    } else {
      throw new Error('Teacher did not receive warning acknowledgement');
    }

    // Test 16: Lock and Unlock
    console.log('\nTest 16: Teacher locks and unlocks student screen');
    teacherWs.send(JSON.stringify({
      type: 'LOCK_STUDENT',
      studentId: studentId,
      locked: true
    }));
    const lockMsg = await waitEvent(studentWs, 'LOCK');
    if (lockMsg.locked === true) {
      console.log('  [PASS] Lock command delivered to student');
    } else {
      throw new Error('Lock command not received');
    }

    teacherWs.send(JSON.stringify({
      type: 'UNLOCK_STUDENT',
      studentId: studentId
    }));
    const unlockMsg = await waitEvent(studentWs, 'LOCK');
    if (unlockMsg.locked === false) {
      console.log('  [PASS] Unlock command delivered to student');
    } else {
      throw new Error('Unlock command not received');
    }

    // Test 17: Student leaves session
    console.log('\nTest 17: Student leaves session');
    studentWs.send(JSON.stringify({
      type: 'LEAVE',
      reason: 'Student logged out'
    }));
    const leaveAlert = await waitEvent(teacherWs, 'ALERTS_UPDATE');
    const studentLeftAlert = leaveAlert.alerts.find(a => a.type === 'STUDENT_LEFT' && a.studentId === studentId);
    if (studentLeftAlert) {
      console.log(`  [PASS] Leaving generated alert for teacher: "${studentLeftAlert.message}"`);
    } else {
      throw new Error('Student left alert not generated');
    }

    teacherWs.close();

    console.log('\n======================================================');
    console.log('  ALL 17 INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
    process.exitCode = 0;
  } catch (err) {
    console.error('\n[FAIL] Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => instance.close(resolve));
    console.log('Server shut down cleanly.');
  }
}

runTests();
