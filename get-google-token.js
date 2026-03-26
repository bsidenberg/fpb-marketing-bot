const http = require('http');
const https = require('https');
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || 'YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3001/callback';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/callback' && parsedUrl.query.code) {
    const code = parsedUrl.query.code;

    const tokenData = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': tokenData.length,
      },
    };

    const tokenReq = https.request(options, (tokenRes) => {
      let data = '';
      tokenRes.on('data', chunk => data += chunk);
      tokenRes.on('end', () => {
        const tokens = JSON.parse(data);
        console.log('\n\n=============================');
        console.log('✅ SUCCESS! Your refresh token:');
        console.log('=============================');
        console.log(tokens.refresh_token);
        console.log('=============================\n');

        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(`<h1>✅ Success!</h1><p>Your refresh token is:</p><code style="font-size:12px;word-break:break-all">${tokens.refresh_token}</code><p>Copy it from the terminal too.</p>`);

        setTimeout(() => server.close(), 2000);
      });
    });

    tokenReq.write(tokenData);
    tokenReq.end();
  }
});

server.listen(3001, () => {
  console.log('\n=============================');
  console.log('Open this URL in your browser:');
  console.log('=============================');
  console.log(authUrl);
  console.log('=============================\n');
});
