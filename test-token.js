const https = require('https');

const data = new URLSearchParams({
  client_id: 'YOUR_CLIENT_ID_HERE',
  client_secret: 'YOUR_CLIENT_SECRET_HERE',
  refresh_token: 'YOUR_REFRESH_TOKEN_HERE',
  grant_type: 'refresh_token',
}).toString();

const options = {
  hostname: 'oauth2.googleapis.com',
  path: '/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': data.length,
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.write(data);
req.end();
