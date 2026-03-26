import urllib.parse
import urllib.request
import json
import http.server
import webbrowser
import threading

CLIENT_ID = 'YOUR_CLIENT_ID_HERE'
CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE'
REDIRECT_URI = 'http://localhost:3001/callback'
SCOPE = 'https://www.googleapis.com/auth/adwords'

auth_url = (
    'https://accounts.google.com/o/oauth2/v2/auth'
    f'?client_id={urllib.parse.quote(CLIENT_ID)}'
    f'&redirect_uri={urllib.parse.quote(REDIRECT_URI)}'
    '&response_type=code'
    f'&scope={urllib.parse.quote(SCOPE)}'
    '&access_type=offline'
    '&prompt=consent'
)

refresh_token_result = []

class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if 'code' in params:
            code = params['code'][0]

            data = urllib.parse.urlencode({
                'code': code,
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'redirect_uri': REDIRECT_URI,
                'grant_type': 'authorization_code',
            }).encode()

            req = urllib.request.Request(
                'https://oauth2.googleapis.com/token',
                data=data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )

            with urllib.request.urlopen(req) as response:
                tokens = json.loads(response.read())

            refresh_token = tokens.get('refresh_token', 'NO REFRESH TOKEN')
            refresh_token_result.append(refresh_token)

            print('\n=============================')
            print('YOUR REFRESH TOKEN:')
            print('=============================')
            print(refresh_token)
            print('=============================\n')

            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(f'<h1>Success!</h1><p>Refresh token:</p><p style="word-break:break-all;font-family:monospace">{refresh_token}</p>'.encode())

        threading.Thread(target=self.server.shutdown).start()

    def log_message(self, format, *args):
        pass

print(f'\nOpen this URL in your browser:\n\n{auth_url}\n')
webbrowser.open(auth_url)

server = http.server.HTTPServer(('localhost', 3001), CallbackHandler)
server.serve_forever()
