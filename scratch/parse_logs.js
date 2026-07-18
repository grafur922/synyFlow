import fs from 'fs';
import path from 'path';

const LOG_FILE = 'C:\\Users\\SL310\\.gemini\\antigravity\\brain\\98450b3c-454d-4c80-91ec-eb4f3c812e3e\\.system_generated\\tasks\\task-298.log';

if (!fs.existsSync(LOG_FILE)) {
  console.log('Log file does not exist.');
  process.exit(1);
}

const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
console.log(`Searching ${lines.length} lines in log file...`);

const keywords = ['3001', '127.0.0.1', 'localhost', 'fetch', 'ERR_', 'warn', 'error', 'failed', 'CORS', 'connect', 'Connection', 'http'];

let count = 0;
for (const line of lines) {
  const matches = keywords.some(k => line.toLowerCase().includes(k.toLowerCase()));
  const isNoise = line.includes('AudioCapabilities') || line.includes('VideoCapabilities') || line.includes('GPUAUX') || line.includes('Tinyxml2') || line.includes('Leanback') || line.includes('MiuiForceDarkConfig');
  
  if (matches && !isNoise) {
    console.log(line);
    count++;
    if (count > 200) {
      console.log('--- Truncated top 200 matches ---');
      break;
    }
  }
}
