import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.resolve('dist/index.js');

console.log('Starting protocol compliance test...');

const child = spawn('node', [serverPath], {
  env: { ...process.env, BROWSER_HEADLESS: 'true' }
});

let stdoutData = '';
let stderrData = '';

child.stdout.on('data', (data) => {
  stdoutData += data.toString();
});

child.stderr.on('data', (data) => {
  stderrData += data.toString();
});

// Give it a few seconds to start up
setTimeout(() => {
  child.kill();
  
  console.log('\n--- Test Result ---');
  if (stdoutData.trim().length > 0) {
    console.error('FAIL: stdout is NOT empty! Current stdout:');
    console.error(stdoutData);
  } else {
    console.log('PASS: stdout is empty.');
  }
  
  console.log('Internal logs (stderr):');
  console.log(stderrData || '(none)');
  
  if (stdoutData.trim().length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}, 5000);
