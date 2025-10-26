// scripts/hmac.cjs
const crypto = require('node:crypto');

const secret = process.argv[2] || 'my_dev_secret';
const payload = process.argv[3] || 'TAG123|1';

const hex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log(hex);
