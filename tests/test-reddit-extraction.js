import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.resolve('dist/index.js');
const redditUrl = 'https://www.reddit.com/r/technology/comments/1bevj1z/us_house_passes_bill_that_could_ban_tiktok/';

console.log('Starting Reddit extraction test...');

// Start the server in stdio mode
const child = spawn('node', [serverPath], {
  env: { ...process.env, BROWSER_HEADLESS: 'true' }
});

let responseData = '';

child.stdout.on('data', (data) => {
  responseData += data.toString();
  // If we get a response, we can stop
  if (responseData.includes('"result"')) {
    console.log('Received response from server.');
    child.kill();
  }
});

child.stderr.on('data', (data) => {
  console.error('[Server Log]', data.toString());
});

// Wait for server to start, then send the request
setTimeout(() => {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'get-single-web-page-content',
      arguments: {
        url: redditUrl
      }
    }
  };
  
  console.log('Sending request to server...');
  child.stdin.write(JSON.stringify(request) + '\n');
}, 2000);

// Timeout if no response
setTimeout(() => {
  child.kill();
  console.log('\n--- Test Result ---');
  if (responseData.includes('TikTok') || responseData.includes('Reddit')) {
    console.log('PASS: Found expected content in response.');
    process.exit(0);
  } else {
    console.error('FAIL: Could not find expected content in response.');
    console.log('Raw response:', responseData);
    process.exit(1);
  }
}, 30000);
